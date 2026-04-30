/**
 * Purpose: Audits legacy Kopia-backed canonical-source rows and optionally re-canonicalizes them into Xet without mutating the original registry audit evidence.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/environment-and-deployment.md
 * - docs/runbooks/source-engine-migration.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://kopia.io/docs/features/
 * Tests:
 * - scripts/source-migration.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const rootDirectory = dirname(dirname(scriptFilePath));
const defaultWorkDirectory = join(
  rootDirectory,
  'scripts',
  'output',
  'source-migration',
  'workspace'
);

function resolveExecutable(command, platform = process.platform) {
  return platform === 'win32' ? `${command}.cmd` : command;
}

function resolvePathFromRoot(path) {
  return path ? resolve(rootDirectory, path) : undefined;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readOptionalBigIntString(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return typeof value === 'bigint' ? value.toString() : String(value);
}

function readRequiredString(value, fieldName) {
  const normalized = readOptionalString(value);

  if (!normalized) {
    throw new Error(`Missing required migration record field "${fieldName}".`);
  }

  return normalized;
}

function normalizeChecksumList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => isPlainObject(entry))
    .map((entry) => ({
      algorithm: readRequiredString(entry.algorithm, 'canonicalDigestSet.algorithm'),
      value: readRequiredString(entry.value, 'canonicalDigestSet.value')
    }));
}

function normalizeReconstructionHandles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => isPlainObject(entry))
    .map((entry) => ({
      kind: readRequiredString(entry.kind, 'sourceReconstructionHandles.kind'),
      value: readRequiredString(entry.value, 'sourceReconstructionHandles.value')
    }));
}

function normalizeSubstrateHints(value) {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [String(key), readOptionalString(entryValue)])
      .filter(([, entryValue]) => entryValue !== undefined)
  );
}

function normalizeMigrationRecord(record) {
  if (!isPlainObject(record)) {
    throw new Error('Migration inventory input records must be objects.');
  }

  const asset = isPlainObject(record.asset) ? record.asset : undefined;
  const assetId = readRequiredString(record.assetId ?? asset?.id, 'assetId');
  const versionId = readRequiredString(record.versionId ?? record.id, 'versionId');
  const repositoryEngine = readOptionalString(record.repositoryEngine);
  const canonicalSourceId = readOptionalString(record.canonicalSourceId);
  const canonicalSnapshotId = readOptionalString(record.canonicalSnapshotId);
  const canonicalLogicalPath = readOptionalString(record.canonicalLogicalPath);

  return {
    assetId,
    versionId,
    versionNumber: Number(record.versionNumber ?? 0),
    serviceNamespaceId: readRequiredString(
      record.serviceNamespaceId ?? asset?.serviceNamespaceId,
      'serviceNamespaceId'
    ),
    tenantScopeId: readOptionalString(record.tenantScopeId ?? asset?.tenantScopeId),
    lifecycleState: readRequiredString(record.lifecycleState, 'lifecycleState'),
    sourceFilename: readRequiredString(record.sourceFilename, 'sourceFilename'),
    repositoryEngine,
    canonicalSourceId,
    canonicalSnapshotId,
    canonicalLogicalPath,
    canonicalDigestSet: normalizeChecksumList(record.canonicalDigestSet),
    canonicalLogicalByteLength: readOptionalBigIntString(record.canonicalLogicalByteLength),
    canonicalStoredByteLength: readOptionalBigIntString(record.canonicalStoredByteLength),
    sourceReconstructionHandles: normalizeReconstructionHandles(record.sourceReconstructionHandles),
    sourceSubstrateHints: normalizeSubstrateHints(record.sourceSubstrateHints),
    isCurrentCanonicalVersion:
      record.isCurrentCanonicalVersion === true || asset?.currentCanonicalVersionId === versionId
  };
}

function hasCanonicalEvidence(record) {
  return Boolean(
    record.canonicalSourceId && record.canonicalSnapshotId && record.canonicalLogicalPath
  );
}

function classifyRecord(record) {
  if (record.repositoryEngine === 'kopia') {
    return {
      inventoryStatus: 'legacy-kopia',
      recanonicalizationStatus: hasCanonicalEvidence(record) ? 'eligible' : 'manual-review',
      reason: hasCanonicalEvidence(record)
        ? 'legacy-kopia-row'
        : 'legacy-kopia-row-missing-canonical-evidence'
    };
  }

  if (!record.repositoryEngine && (record.canonicalSourceId || record.canonicalSnapshotId || record.canonicalLogicalPath)) {
    return {
      inventoryStatus: 'missing-engine',
      recanonicalizationStatus: 'manual-review',
      reason: 'repository-engine-missing'
    };
  }

  if (record.repositoryEngine === 'xet') {
    return {
      inventoryStatus: 'xet',
      recanonicalizationStatus: 'not-needed',
      reason: 'already-xet'
    };
  }

  return {
    inventoryStatus: 'other-engine',
    recanonicalizationStatus: 'not-needed',
    reason: record.repositoryEngine ? 'other-engine' : 'non-canonical-row'
  };
}

function toSerializableValue(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toSerializableValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, toSerializableValue(entryValue)])
    );
  }

  return value;
}

function toSnapshotInput(record) {
  if (!record.repositoryEngine) {
    throw new Error(
      `Version "${record.versionId}" is missing repositoryEngine and cannot be re-canonicalized safely.`
    );
  }

  if (!hasCanonicalEvidence(record)) {
    throw new Error(
      `Version "${record.versionId}" is missing canonical source evidence and cannot be re-canonicalized safely.`
    );
  }

  return {
    canonicalSourceId: record.canonicalSourceId,
    snapshot: {
      repositoryEngine: record.repositoryEngine,
      canonicalSourceId: record.canonicalSourceId,
      snapshotId: record.canonicalSnapshotId,
      logicalPath: record.canonicalLogicalPath,
      digests: record.canonicalDigestSet,
      ...(record.canonicalLogicalByteLength
        ? { logicalByteLength: BigInt(record.canonicalLogicalByteLength) }
        : {}),
      ...(record.canonicalStoredByteLength
        ? { storedByteLength: BigInt(record.canonicalStoredByteLength) }
        : {}),
      ...(record.sourceReconstructionHandles.length > 0
        ? { reconstructionHandles: record.sourceReconstructionHandles }
        : {}),
      ...(record.sourceSubstrateHints ? { substrateHints: record.sourceSubstrateHints } : {})
    }
  };
}

function toSerializableCandidate(snapshot) {
  return {
    repositoryEngine: snapshot.repositoryEngine,
    canonicalSourceId: snapshot.canonicalSourceId,
    canonicalSnapshotId: snapshot.snapshotId,
    canonicalLogicalPath: snapshot.logicalPath,
    canonicalDigestSet: snapshot.digests,
    ...(snapshot.logicalByteLength === undefined
      ? {}
      : { canonicalLogicalByteLength: snapshot.logicalByteLength.toString() }),
    ...(snapshot.storedByteLength === undefined
      ? {}
      : { canonicalStoredByteLength: snapshot.storedByteLength.toString() }),
    ...(snapshot.reconstructionHandles
      ? { sourceReconstructionHandles: snapshot.reconstructionHandles }
      : {}),
    ...(snapshot.substrateHints ? { sourceSubstrateHints: snapshot.substrateHints } : {}),
    ...(snapshot.dedupeMetrics ? { dedupeMetrics: toSerializableValue(snapshot.dedupeMetrics) } : {})
  };
}

export function buildInventoryReport(records, options = {}) {
  const normalizedRecords = records.map((record) => normalizeMigrationRecord(record));
  const summary = {
    totalRows: normalizedRecords.length,
    xetRows: 0,
    legacyKopiaRows: 0,
    missingEngineRows: 0,
    otherEngineRows: 0,
    eligibleLegacyRows: 0,
    manualReviewRows: 0
  };
  const riskyRows = [];

  for (const record of normalizedRecords) {
    const classification = classifyRecord(record);

    switch (classification.inventoryStatus) {
      case 'xet':
        summary.xetRows += 1;
        break;
      case 'legacy-kopia':
        summary.legacyKopiaRows += 1;
        break;
      case 'missing-engine':
        summary.missingEngineRows += 1;
        break;
      default:
        summary.otherEngineRows += 1;
        break;
    }

    if (classification.recanonicalizationStatus === 'eligible') {
      summary.eligibleLegacyRows += 1;
    }

    if (classification.recanonicalizationStatus === 'manual-review') {
      summary.manualReviewRows += 1;
    }

    if (classification.inventoryStatus === 'legacy-kopia' || classification.inventoryStatus === 'missing-engine') {
      riskyRows.push({
        ...record,
        inventoryStatus: classification.inventoryStatus,
        recanonicalizationStatus: classification.recanonicalizationStatus,
        reason: classification.reason
      });
    }
  }

  return {
    command: 'inventory',
    generatedAt: new Date().toISOString(),
    source: {
      mode: options.sourceMode ?? 'file',
      ...(options.filters ? { filters: options.filters } : {})
    },
    summary,
    riskyRows: riskyRows.map((record) => toSerializableValue(record))
  };
}

export function buildRecanonicalizationPlan(records, options = {}) {
  const normalizedRecords = records.map((record) => normalizeMigrationRecord(record));
  const operations = normalizedRecords
    .map((record) => {
      const classification = classifyRecord(record);

      if (
        classification.inventoryStatus !== 'legacy-kopia' &&
        classification.inventoryStatus !== 'missing-engine'
      ) {
        return undefined;
      }

      return {
        ...record,
        inventoryStatus: classification.inventoryStatus,
        recanonicalizationStatus: classification.recanonicalizationStatus,
        reason: classification.reason,
        registryMutation: 'none'
      };
    })
    .filter(Boolean);

  const summary = {
    selectedRows: operations.length,
    eligibleRows: operations.filter((operation) => operation.recanonicalizationStatus === 'eligible')
      .length,
    manualReviewRows: operations.filter(
      (operation) => operation.recanonicalizationStatus === 'manual-review'
    ).length,
    materializedRows: 0,
    failedRows: 0
  };

  return {
    command: 'recanonicalize',
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    registryMutation: 'none',
    targetEngine: options.targetEngine ?? 'xet',
    source: {
      mode: options.sourceMode ?? 'file',
      ...(options.filters ? { filters: options.filters } : {})
    },
    summary,
    operations: operations.map((operation) => toSerializableValue(operation))
  };
}

async function loadRecordsFromFile(path) {
  const payload = JSON.parse(await readFile(path, 'utf8'));
  const records = Array.isArray(payload) ? payload : payload?.versions;

  if (!Array.isArray(records)) {
    throw new Error('Source migration input files must be a JSON array or an object with a "versions" array.');
  }

  return records.map((record) => normalizeMigrationRecord(record));
}

function runWorkspaceScript(workspace, scriptName) {
  const result = spawnSync(resolveExecutable('npm'), ['run', scriptName, '--workspace', workspace], {
    cwd: rootDirectory,
    encoding: 'utf8',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Workspace command failed: npm run ${scriptName} --workspace ${workspace}`,
        result.stdout.trim(),
        result.stderr.trim()
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
}

async function loadStorageWorkspace() {
  const entryPath = join(rootDirectory, 'packages', 'storage', 'dist', 'index.js');

  if (!existsSync(entryPath)) {
    runWorkspaceScript('@cdngine/storage', 'build');
  }

  return import(pathToFileURL(entryPath).href);
}

async function createDefaultSourceRepository(environment = process.env) {
  const storageModule = await loadStorageWorkspace();

  return storageModule.createSourceRepositoryFromEnvironment({
    environment,
    xet: {
      snapshotStore: new storageModule.InMemoryXetSnapshotStore()
    }
  });
}

async function loadRecordsFromDatabase(options) {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      'DATABASE_URL is required when --from-file is not provided for source migration commands.'
    );
  }

  const clientPath = join(
    rootDirectory,
    'packages',
    'registry',
    'src',
    'generated',
    'prisma',
    'client.js'
  );

  if (!existsSync(clientPath)) {
    runWorkspaceScript('@cdngine/registry', 'prisma:generate');
  }

  const { PrismaClient } = await import(pathToFileURL(clientPath).href);
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.assetVersion.findMany({
      where: {
        ...(options.assetId ? { assetId: options.assetId } : {}),
        ...(options.versionId ? { id: options.versionId } : {}),
        ...((options.serviceNamespaceId || options.tenantScopeId)
          ? {
              asset: {
                ...(options.serviceNamespaceId
                  ? { serviceNamespaceId: options.serviceNamespaceId }
                  : {}),
                ...(options.tenantScopeId ? { tenantScopeId: options.tenantScopeId } : {})
              }
            }
          : {})
      },
      orderBy: [{ assetId: 'asc' }, { versionNumber: 'asc' }],
      ...(typeof options.limit === 'number' ? { take: options.limit } : {}),
      select: {
        id: true,
        assetId: true,
        versionNumber: true,
        lifecycleState: true,
        sourceFilename: true,
        repositoryEngine: true,
        canonicalSourceId: true,
        canonicalSnapshotId: true,
        canonicalLogicalPath: true,
        canonicalDigestSet: true,
        canonicalLogicalByteLength: true,
        canonicalStoredByteLength: true,
        sourceReconstructionHandles: true,
        sourceSubstrateHints: true,
        asset: {
          select: {
            id: true,
            serviceNamespaceId: true,
            tenantScopeId: true,
            currentCanonicalVersionId: true
          }
        }
      }
    });

    return rows.map((row) =>
      normalizeMigrationRecord({
        ...row,
        versionId: row.id
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function loadRecords(options, dependencies = {}) {
  if (dependencies.loadRecords) {
    return dependencies.loadRecords(options);
  }

  if (options.fromFile) {
    return loadRecordsFromFile(options.fromFile);
  }

  return loadRecordsFromDatabase(options);
}

function writeReport(report, outputPath, stdoutWriter = (value) => process.stdout.write(value)) {
  const serialized = JSON.stringify(toSerializableValue(report), null, 2);

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${serialized}\n`);
    return;
  }

  stdoutWriter(`${serialized}\n`);
}

function buildFilterSummary(options) {
  return {
    ...(options.assetId ? { assetId: options.assetId } : {}),
    ...(options.serviceNamespaceId ? { serviceNamespaceId: options.serviceNamespaceId } : {}),
    ...(options.tenantScopeId ? { tenantScopeId: options.tenantScopeId } : {}),
    ...(options.versionId ? { versionId: options.versionId } : {}),
    ...(typeof options.limit === 'number' ? { limit: options.limit } : {})
  };
}

export async function runInventoryCommand(options, dependencies = {}) {
  const records = await loadRecords(options, dependencies);
  const report = buildInventoryReport(records, {
    filters: buildFilterSummary(options),
    sourceMode: options.fromFile ? 'file' : dependencies.loadRecords ? 'custom' : 'database'
  });
  writeReport(report, options.output, dependencies.stdoutWriter);
  return report;
}

export async function runRecanonicalizeCommand(options, dependencies = {}) {
  const targetEngine = dependencies.resolveTargetEngine
    ? dependencies.resolveTargetEngine(options)
    : process.env.CDNGINE_SOURCE_ENGINE?.trim() || 'xet';
  const records = await loadRecords(options, dependencies);
  const report = buildRecanonicalizationPlan(records, {
    apply: options.apply,
    filters: buildFilterSummary(options),
    sourceMode: options.fromFile ? 'file' : dependencies.loadRecords ? 'custom' : 'database',
    targetEngine
  });

  if (!options.apply) {
    writeReport(report, options.output, dependencies.stdoutWriter);
    return report;
  }

  if (targetEngine !== 'xet') {
    throw new Error(
      `Re-canonicalization apply mode requires Xet as the target engine. Received "${targetEngine}".`
    );
  }

  const sourceRepository = dependencies.createSourceRepository
    ? await dependencies.createSourceRepository(options)
    : await createDefaultSourceRepository(process.env);
  const workDirectory = options.workDir ?? defaultWorkDirectory;

  await mkdir(workDirectory, { recursive: true });

  for (const operation of report.operations) {
    if (operation.recanonicalizationStatus !== 'eligible') {
      continue;
    }

    const restorePath = join(
      workDirectory,
      'restores',
      operation.assetId,
      operation.versionId,
      basename(operation.sourceFilename)
    );

    try {
      await mkdir(dirname(restorePath), { recursive: true });
      const restored = await sourceRepository.restoreToPath({
        ...toSnapshotInput(operation),
        destinationPath: restorePath
      });
      const candidateSnapshot = await sourceRepository.snapshotFromPath({
        assetVersionId: operation.versionId,
        localPath: restored.restoredPath,
        sourceFilename: basename(operation.sourceFilename),
        ...(operation.canonicalLogicalByteLength
          ? { logicalByteLength: BigInt(operation.canonicalLogicalByteLength) }
          : {}),
        ...(operation.canonicalDigestSet.length > 0
          ? { sourceDigests: operation.canonicalDigestSet }
          : {}),
        metadata: {
          migrationSourceAssetId: operation.assetId,
          migrationSourceVersionId: operation.versionId,
          originalRepositoryEngine: operation.repositoryEngine
        }
      });

      operation.recanonicalizationStatus = 'recanonicalized';
      operation.reason = 'legacy-kopia-restored-and-snapshotted-into-xet';
      operation.registryMutation = 'none';
      operation.candidateCanonicalSource = toSerializableCandidate(candidateSnapshot);
      report.summary.materializedRows += 1;
    } catch (error) {
      operation.recanonicalizationStatus = 'failed';
      operation.reason = error instanceof Error ? error.message : 'Unknown re-canonicalization failure.';
      report.summary.failedRows += 1;
    } finally {
      await rm(dirname(restorePath), { recursive: true, force: true });
    }
  }

  await rm(join(workDirectory, 'restores'), { recursive: true, force: true });

  writeReport(report, options.output, dependencies.stdoutWriter);
  return report;
}

function readFlagValue(argv, index, flag) {
  if (index + 1 >= argv.length) {
    throw new Error(`${flag} requires a value.`);
  }

  return argv[index + 1];
}

export function parseCliArguments(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return {
      command: 'help'
    };
  }

  const [command = 'inventory', ...rest] = argv;
  const parsed = {
    command,
    apply: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];

    switch (argument) {
      case '--apply':
        parsed.apply = true;
        break;
      case '--from-file':
        parsed.fromFile = resolvePathFromRoot(readFlagValue(rest, index, argument));
        index += 1;
        break;
      case '--output':
        parsed.output = resolvePathFromRoot(readFlagValue(rest, index, argument));
        index += 1;
        break;
      case '--work-dir':
        parsed.workDir = resolvePathFromRoot(readFlagValue(rest, index, argument));
        index += 1;
        break;
      case '--asset-id':
        parsed.assetId = readFlagValue(rest, index, argument);
        index += 1;
        break;
      case '--service-namespace-id':
        parsed.serviceNamespaceId = readFlagValue(rest, index, argument);
        index += 1;
        break;
      case '--tenant-scope-id':
        parsed.tenantScopeId = readFlagValue(rest, index, argument);
        index += 1;
        break;
      case '--version-id':
        parsed.versionId = readFlagValue(rest, index, argument);
        index += 1;
        break;
      case '--limit': {
        const rawValue = readFlagValue(rest, index, argument);
        const parsedValue = Number(rawValue);

        if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
          throw new Error(`--limit must be a positive integer. Received "${rawValue}".`);
        }

        parsed.limit = parsedValue;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown source migration argument "${argument}".`);
    }
  }

  if (!['inventory', 'recanonicalize'].includes(parsed.command)) {
    throw new Error(`Unknown source migration command "${parsed.command}". Use "inventory" or "recanonicalize".`);
  }

  return parsed;
}

export function getUsageText() {
  return [
    'Usage:',
    '  npm run source:migration -- inventory [--from-file path] [--output path] [--asset-id id] [--service-namespace-id id] [--tenant-scope-id id] [--version-id id] [--limit n]',
    '  npm run source:migration -- recanonicalize [--from-file path] [--output path] [--work-dir path] [--apply] [--asset-id id] [--service-namespace-id id] [--tenant-scope-id id] [--version-id id] [--limit n]',
    '',
    'Notes:',
    '  - inventory reports legacy repositoryEngine = kopia rows and canonical rows that are missing repositoryEngine.',
    '  - recanonicalize defaults to a dry-run plan and only snapshots into Xet when --apply is supplied.',
    '  - apply mode never rewrites AssetVersion rows; it produces candidate Xet evidence so operators can keep legacy Kopia rows auditable during the dual-read window.'
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseCliArguments(argv);

  if (options.command === 'help') {
    const usageText = getUsageText();

    if (dependencies.stdoutWriter) {
      dependencies.stdoutWriter(`${usageText}\n`);
    } else {
      process.stdout.write(`${usageText}\n`);
    }

    return {
      command: 'help'
    };
  }

  switch (options.command) {
    case 'inventory':
      return runInventoryCommand(options, dependencies);
    case 'recanonicalize':
      return runRecanonicalizeCommand(options, dependencies);
    default:
      throw new Error(`Unsupported source migration command "${options.command}".`);
  }
}

if (process.argv[1] === scriptFilePath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
