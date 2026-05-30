/**
 * Purpose: Implements generic archive split/repack adapters for split-history source storage across package-like artifacts.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/workflow-extensibility.md
 * External references:
 * - https://www.gnu.org/software/tar/manual/html_node/Standard.html
 * - https://www.rfc-editor.org/rfc/rfc1952
 * - https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 * Tests:
 * - packages/storage/test/split-artifact-adapters.test.ts
 */
import { createHash } from 'node:crypto';
import { deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';

export type SplitArtifactFormat = 'gzip-tar' | 'tar' | 'unitypackage' | 'zip';
export type SplitArtifactRepresentation = 'split' | 'whole';
export type SplitArtifactStatus =
  | 'split_complete'
  | 'split_failed_retryable'
  | 'split_failed_terminal'
  | 'split_pending'
  | 'split_running';

export interface SplitArtifactLimits {
  maxEntryCount: number;
  maxEntryByteLength: number;
  maxTotalUnpackedByteLength: number;
}

export interface SplitArtifactEntry {
  data: Buffer;
  logicalPath: string;
  mode?: number;
  mtime?: Date;
}

export interface SplitArtifactArchiveInput {
  archive: Buffer;
  filename: string;
  limits?: Partial<SplitArtifactLimits>;
}

export interface SplitArtifactArchiveResult {
  entries: SplitArtifactEntry[];
  format: SplitArtifactFormat;
  originalLogicalByteLength: number;
}

export interface CreateSplitArtifactArchiveInput {
  entries: readonly SplitArtifactEntry[];
  format: SplitArtifactFormat;
  skipPathValidationForTesting?: boolean;
}

export interface SplitArtifactManifest {
  assetId: string;
  entries: Array<{
    index: number;
    logicalPath: string;
    mode?: number;
    mtime?: string;
    sha256: string;
    size: number;
  }>;
  format: SplitArtifactFormat;
  originalArchive: {
    filename: string;
    logicalByteLength: number;
    sha256: string;
  };
  reconstructionFidelity: 'content-equivalent';
  totalEntryByteLength: number;
}

export interface CreateSplitArtifactManifestInput {
  assetId: string;
  originalArchive: Buffer;
  originalFilename: string;
  split: SplitArtifactArchiveResult;
}

export interface SplitHistoryVersionCandidate {
  filename: string;
  representation: SplitArtifactRepresentation;
  splitStatus?: SplitArtifactStatus;
  versionId: string;
}

export interface SplitHistoryPlanInput {
  currentVersionId: string;
  policyEnabled: boolean;
  versions: readonly SplitHistoryVersionCandidate[];
}

export interface SplitHistoryPlan {
  currentVersionId: string;
  demoteVersionIds: string[];
  skippedVersionIds: string[];
}

const defaultLimits: SplitArtifactLimits = {
  maxEntryByteLength: 1024 * 1024 * 1024,
  maxEntryCount: 50_000,
  maxTotalUnpackedByteLength: 16 * 1024 * 1024 * 1024
};

const zipSignature = 0x04034b50;
const zipCentralDirectorySignature = 0x02014b50;
const zipEndOfCentralDirectorySignature = 0x06054b50;

export class ArchiveSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveSafetyError';
  }
}

export class UnsupportedSplitArtifactError extends Error {
  constructor(filename: string) {
    super(`No split-history adapter is registered for "${filename}".`);
    this.name = 'UnsupportedSplitArtifactError';
  }
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function resolveLimits(limits?: Partial<SplitArtifactLimits>): SplitArtifactLimits {
  return {
    ...defaultLimits,
    ...(limits ?? {})
  };
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

function readNullTerminated(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function parseTarOctal(buffer: Buffer, start: number, length: number): number {
  const value = readNullTerminated(buffer, start, length).trim();
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 8);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ArchiveSafetyError(`Invalid tar numeric field "${value}".`);
  }

  return parsed;
}

function writeTarOctal(buffer: Buffer, start: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, '0').slice(-(length - 1));
  buffer.write(encoded, start, length - 1, 'ascii');
  buffer[start + length - 1] = 0;
}

function padLength(length: number, blockSize: number): number {
  return Math.ceil(length / blockSize) * blockSize;
}

function normalizeArchivePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/g, '');
  const segments = normalized.split('/').filter(Boolean);

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some((segment) => segment === '..' || segment === '.')
  ) {
    throw new ArchiveSafetyError(`Unsafe archive path "${rawPath}".`);
  }

  return segments.join('/');
}

function validateEntries(
  entries: readonly SplitArtifactEntry[],
  limits: SplitArtifactLimits,
  options: { skipPathValidation?: boolean } = {}
): SplitArtifactEntry[] {
  if (entries.length > limits.maxEntryCount) {
    throw new ArchiveSafetyError(`Archive has ${entries.length} entries, above limit ${limits.maxEntryCount}.`);
  }

  const seen = new Set<string>();
  let total = 0;

  return entries.map((entry) => {
    const logicalPath = options.skipPathValidation
      ? entry.logicalPath
      : normalizeArchivePath(entry.logicalPath);

    if (seen.has(logicalPath)) {
      throw new ArchiveSafetyError(`Archive contains duplicate path "${logicalPath}".`);
    }

    if (entry.data.length > limits.maxEntryByteLength) {
      throw new ArchiveSafetyError(`Archive entry "${logicalPath}" exceeds per-entry byte limit.`);
    }

    total += entry.data.length;
    if (total > limits.maxTotalUnpackedByteLength) {
      throw new ArchiveSafetyError('Archive exceeds total unpacked byte limit.');
    }

    seen.add(logicalPath);
    return {
      data: Buffer.from(entry.data),
      logicalPath,
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
      ...(entry.mtime === undefined ? {} : { mtime: new Date(entry.mtime) })
    };
  });
}

function looksLikeTar(buffer: Buffer): boolean {
  if (buffer.length < 1024 || buffer.length % 512 !== 0) {
    return false;
  }

  return buffer.subarray(257, 263).toString('ascii').startsWith('ustar') || isZeroBlock(buffer.subarray(0, 512));
}

function looksLikeGzipTar(buffer: Buffer): boolean {
  if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
    return false;
  }

  try {
    return looksLikeTar(gunzipSync(buffer));
  } catch {
    return false;
  }
}

function looksLikeZip(buffer: Buffer): boolean {
  return findZipEndOfCentralDirectory(buffer) !== null;
}

export function detectSplitArtifactFormat(
  filename: string,
  archive: Buffer
): { format: SplitArtifactFormat } | null {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.unitypackage')) {
    return looksLikeGzipTar(archive) ? { format: 'unitypackage' } : null;
  }

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return looksLikeGzipTar(archive) ? { format: 'gzip-tar' } : null;
  }

  if (lower.endsWith('.tar')) {
    return looksLikeTar(archive) ? { format: 'tar' } : null;
  }

  if (lower.endsWith('.zip')) {
    return looksLikeZip(archive) ? { format: 'zip' } : null;
  }

  return null;
}

function unpackTar(tarBuffer: Buffer, limits: SplitArtifactLimits): SplitArtifactEntry[] {
  const entries: SplitArtifactEntry[] = [];
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }

    const name = readNullTerminated(header, 0, 100);
    const mode = parseTarOctal(header, 100, 8);
    const size = parseTarOctal(header, 124, 12);
    const mtimeSeconds = parseTarOctal(header, 136, 12);
    const typeflag = header.subarray(156, 157).toString('ascii') || '0';
    const prefix = readNullTerminated(header, 345, 155);
    const logicalPath = normalizeArchivePath(prefix ? `${prefix}/${name}` : name);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (dataEnd > tarBuffer.length) {
      throw new ArchiveSafetyError(`Tar entry "${logicalPath}" extends past archive end.`);
    }

    if (typeflag === '0' || typeflag === '\0') {
      entries.push({
        data: Buffer.from(tarBuffer.subarray(dataStart, dataEnd)),
        logicalPath,
        mode,
        mtime: new Date(mtimeSeconds * 1000)
      });
    } else if (typeflag !== '5') {
      throw new ArchiveSafetyError(`Unsupported tar entry type "${typeflag}" for "${logicalPath}".`);
    }

    offset = dataStart + padLength(size, 512);
  }

  return validateEntries(entries, limits);
}

function writeTarHeader(entry: SplitArtifactEntry, options: { skipPathValidation?: boolean } = {}): Buffer {
  const header = Buffer.alloc(512, 0);
  const logicalPath = options.skipPathValidation ? entry.logicalPath : normalizeArchivePath(entry.logicalPath);
  const pathBytes = Buffer.from(logicalPath, 'utf8');
  const name = pathBytes.length <= 100 ? logicalPath : logicalPath.slice(-100);
  const prefix =
    pathBytes.length <= 100 ? '' : logicalPath.slice(0, Math.max(0, logicalPath.length - name.length - 1));

  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) {
    throw new ArchiveSafetyError(`Tar path "${logicalPath}" is too long for ustar output.`);
  }

  header.write(name, 0, 100, 'utf8');
  writeTarOctal(header, 100, 8, entry.mode ?? 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, entry.data.length);
  writeTarOctal(header, 136, 12, Math.floor((entry.mtime?.getTime() ?? 0) / 1000));
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (prefix) {
    header.write(prefix, 345, 155, 'utf8');
  }

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function packTar(entries: readonly SplitArtifactEntry[], options: { skipPathValidation?: boolean } = {}): Buffer {
  const buffers: Buffer[] = [];

  for (const entry of entries) {
    buffers.push(writeTarHeader(entry, options));
    buffers.push(Buffer.from(entry.data));
    const padding = padLength(entry.data.length, 512) - entry.data.length;
    if (padding > 0) {
      buffers.push(Buffer.alloc(padding, 0));
    }
  }

  buffers.push(Buffer.alloc(1024, 0));
  return Buffer.concat(buffers);
}

const crc32Table = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findZipEndOfCentralDirectory(buffer: Buffer): number | null {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === zipEndOfCentralDirectorySignature) {
      return offset;
    }
  }
  return null;
}

function unpackZip(buffer: Buffer, limits: SplitArtifactLimits): SplitArtifactEntry[] {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset === null) {
    throw new ArchiveSafetyError('Zip end of central directory was not found.');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: SplitArtifactEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== zipCentralDirectorySignature) {
      throw new ArchiveSafetyError('Invalid zip central directory entry.');
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const logicalPath = normalizeArchivePath(rawName);

    if ((flags & 0x1) !== 0) {
      throw new ArchiveSafetyError(`Encrypted zip entry "${logicalPath}" is not supported.`);
    }

    if (rawName.endsWith('/')) {
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== zipSignature) {
      throw new ArchiveSafetyError(`Invalid local header for zip entry "${logicalPath}".`);
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? Buffer.from(inflateRawSync(compressed))
          : undefined;

    if (!data) {
      throw new ArchiveSafetyError(`Unsupported zip compression method ${method} for "${logicalPath}".`);
    }

    if (data.length !== uncompressedSize || crc32(data) !== crc) {
      throw new ArchiveSafetyError(`Zip entry "${logicalPath}" failed size or CRC validation.`);
    }

    entries.push({
      data,
      logicalPath
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return validateEntries(entries, limits);
}

function dosDateTime(date: Date | undefined): { date: number; time: number } {
  const value = date ?? new Date('1980-01-01T00:00:00Z');
  const year = Math.max(1980, value.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate(),
    time: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2)
  };
}

function packZip(entries: readonly SplitArtifactEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(normalizeArchivePath(entry.logicalPath), 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const timestamps = dosDateTime(entry.mtime);
    const local = Buffer.alloc(30 + name.length);
    const central = Buffer.alloc(46 + name.length);

    local.writeUInt32LE(zipSignature, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(timestamps.time, 10);
    local.writeUInt16LE(timestamps.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    central.writeUInt32LE(zipCentralDirectorySignature, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(timestamps.time, 12);
    central.writeUInt16LE(timestamps.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    localParts.push(local, compressed);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(zipEndOfCentralDirectorySignature, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

export function splitArtifactArchive(input: SplitArtifactArchiveInput): SplitArtifactArchiveResult {
  const detected = detectSplitArtifactFormat(input.filename, input.archive);
  if (!detected) {
    throw new UnsupportedSplitArtifactError(input.filename);
  }

  const limits = resolveLimits(input.limits);
  const entries =
    detected.format === 'zip'
      ? unpackZip(input.archive, limits)
      : unpackTar(
          detected.format === 'tar' ? input.archive : gunzipSync(input.archive),
          limits
        );

  return {
    entries,
    format: detected.format,
    originalLogicalByteLength: input.archive.length
  };
}

export function createSplitArtifactArchive(input: CreateSplitArtifactArchiveInput): Buffer {
  const pathValidationOptions = input.skipPathValidationForTesting
    ? { skipPathValidation: true }
    : {};
  const entries = validateEntries(resolveEntries(input.entries), defaultLimits, pathValidationOptions);

  if (input.format === 'zip') {
    return packZip(entries);
  }

  const tar = packTar(entries, pathValidationOptions);
  return input.format === 'tar' ? tar : gzipSync(tar);
}

function resolveEntries(entries: readonly SplitArtifactEntry[]): SplitArtifactEntry[] {
  return entries.map((entry) => ({
    data: Buffer.from(entry.data),
    logicalPath: entry.logicalPath,
    ...(entry.mode === undefined ? {} : { mode: entry.mode }),
    ...(entry.mtime === undefined ? {} : { mtime: entry.mtime })
  }));
}

export function createSplitArtifactManifest(input: CreateSplitArtifactManifestInput): SplitArtifactManifest {
  return {
    assetId: input.assetId,
    entries: input.split.entries.map((entry, index) => ({
      index,
      logicalPath: entry.logicalPath,
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
      ...(entry.mtime === undefined ? {} : { mtime: entry.mtime.toISOString() }),
      sha256: sha256Hex(entry.data),
      size: entry.data.length
    })),
    format: input.split.format,
    originalArchive: {
      filename: input.originalFilename,
      logicalByteLength: input.originalArchive.length,
      sha256: sha256Hex(input.originalArchive)
    },
    reconstructionFidelity: 'content-equivalent',
    totalEntryByteLength: input.split.entries.reduce((sum, entry) => sum + entry.data.length, 0)
  };
}

export function compareSplitEntryDigestTrees(
  leftEntries: readonly SplitArtifactEntry[],
  rightEntries: readonly SplitArtifactEntry[]
): boolean {
  const toDigestTree = (entries: readonly SplitArtifactEntry[]) =>
    JSON.stringify(
      entries
        .map((entry): [string, string] => [normalizeArchivePath(entry.logicalPath), sha256Hex(entry.data)])
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    );

  return toDigestTree(leftEntries) === toDigestTree(rightEntries);
}

export function isSplitArtifactEligibleFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.unitypackage')
  );
}

export function planSplitHistoryDemotion(input: SplitHistoryPlanInput): SplitHistoryPlan {
  if (!input.policyEnabled) {
    return {
      currentVersionId: input.currentVersionId,
      demoteVersionIds: [],
      skippedVersionIds: input.versions.map((version) => version.versionId)
    };
  }

  const demoteVersionIds: string[] = [];
  const skippedVersionIds: string[] = [];

  for (const version of input.versions) {
    if (
      version.versionId !== input.currentVersionId &&
      version.representation === 'whole' &&
      isSplitArtifactEligibleFilename(version.filename)
    ) {
      demoteVersionIds.push(version.versionId);
    } else {
      skippedVersionIds.push(version.versionId);
    }
  }

  return {
    currentVersionId: input.currentVersionId,
    demoteVersionIds,
    skippedVersionIds
  };
}
