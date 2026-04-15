/**
 * Purpose: Defines operator-control and diagnostics services for replay, quarantine, release, purge, and audit-aligned version diagnostics.
 * Governing docs:
 * - docs/observability.md
 * - docs/security-model.md
 * - docs/runbooks/quarantine-and-release.md
 * - docs/temporal-message-contracts.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/workflows/message-passing
 * - https://opentelemetry.io/docs/languages/js/
 * Tests:
 * - apps/api/test/operator-routes.test.mjs
 */

export type OperatorLifecycleState =
  | 'canonical'
  | 'processing'
  | 'published'
  | 'quarantined'
  | 'purged'
  | 'failed_retryable';

export type OperatorAction = 'reprocess' | 'quarantine' | 'release' | 'purge';

export interface OperatorActionAccepted {
  action: OperatorAction;
  operationId: string;
  state: 'accepted' | 'pending';
  workflowId?: string;
}

export interface VersionDiagnostics {
  assetId: string;
  lifecycleState: OperatorLifecycleState;
  publication?: {
    derivativeCount?: number;
    manifestType?: string;
  };
  versionId: string;
  workflow: {
    state: string;
    workflowId?: string;
  };
}

export interface OperatorAuditEvent {
  action: OperatorAction;
  actorSubject: string;
  assetId: string;
  operationId: string;
  recordedAt: Date;
  versionId: string;
  workflowId?: string;
}

export interface OperatorControlStore {
  getAuditEvents(versionId: string): Promise<OperatorAuditEvent[]>;
  getDiagnostics(assetId: string, versionId: string): Promise<VersionDiagnostics | null>;
  purgeVersion(assetId: string, versionId: string, actorSubject: string): Promise<OperatorActionAccepted>;
  quarantineVersion(assetId: string, versionId: string, actorSubject: string): Promise<OperatorActionAccepted>;
  releaseVersion(assetId: string, versionId: string, actorSubject: string): Promise<OperatorActionAccepted>;
  reprocessVersion(assetId: string, versionId: string, actorSubject: string): Promise<OperatorActionAccepted>;
}

export class OperatorVersionNotFoundError extends Error {
  constructor(readonly assetId: string, readonly versionId: string) {
    super(`Version "${versionId}" for asset "${assetId}" does not exist.`);
    this.name = 'OperatorVersionNotFoundError';
  }
}

export class OperatorActionRejectedError extends Error {
  constructor(
    readonly action: OperatorAction,
    readonly assetId: string,
    readonly versionId: string,
    readonly lifecycleState: OperatorLifecycleState
  ) {
    super(
      `Operator action "${action}" is not allowed for version "${versionId}" in lifecycle state "${lifecycleState}".`
    );
    this.name = 'OperatorActionRejectedError';
  }
}

interface OperatorVersionRecord extends VersionDiagnostics {}

export interface SeedOperatorVersionRecord {
  assetId: string;
  derivativeCount?: number;
  lifecycleState: OperatorLifecycleState;
  manifestType?: string;
  versionId: string;
  workflowId?: string;
  workflowState: string;
}

export interface InMemoryOperatorControlStoreOptions {
  generateId?: (prefix: 'op') => string;
  now?: () => Date;
  versions?: SeedOperatorVersionRecord[];
}

function cloneAuditEvent(event: OperatorAuditEvent): OperatorAuditEvent {
  return {
    action: event.action,
    actorSubject: event.actorSubject,
    assetId: event.assetId,
    operationId: event.operationId,
    recordedAt: new Date(event.recordedAt),
    versionId: event.versionId,
    ...(event.workflowId ? { workflowId: event.workflowId } : {})
  };
}

function cloneDiagnostics(record: OperatorVersionRecord): VersionDiagnostics {
  return {
    assetId: record.assetId,
    lifecycleState: record.lifecycleState,
    ...(record.publication
      ? {
          publication: {
            ...(typeof record.publication.derivativeCount === 'number'
              ? { derivativeCount: record.publication.derivativeCount }
              : {}),
            ...(record.publication.manifestType
              ? { manifestType: record.publication.manifestType }
              : {})
          }
        }
      : {}),
    versionId: record.versionId,
    workflow: {
      state: record.workflow.state,
      ...(record.workflow.workflowId ? { workflowId: record.workflow.workflowId } : {})
    }
  };
}

export class InMemoryOperatorControlStore implements OperatorControlStore {
  private readonly auditEvents = new Map<string, OperatorAuditEvent[]>();
  private readonly generateId: (prefix: 'op') => string;
  private readonly now: () => Date;
  private readonly versions = new Map<string, OperatorVersionRecord>();

  constructor(options: InMemoryOperatorControlStoreOptions = {}) {
    this.generateId =
      options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 26)}`);
    this.now = options.now ?? (() => new Date());

    for (const version of options.versions ?? []) {
      this.versions.set(this.buildKey(version.assetId, version.versionId), {
        assetId: version.assetId,
        lifecycleState: version.lifecycleState,
        ...(version.derivativeCount || version.manifestType
          ? {
              publication: {
                ...(typeof version.derivativeCount === 'number'
                  ? { derivativeCount: version.derivativeCount }
                  : {}),
                ...(version.manifestType ? { manifestType: version.manifestType } : {})
              }
            }
          : {}),
        versionId: version.versionId,
        workflow: {
          state: version.workflowState,
          ...(version.workflowId ? { workflowId: version.workflowId } : {})
        }
      });
    }
  }

  async getAuditEvents(versionId: string): Promise<OperatorAuditEvent[]> {
    return (this.auditEvents.get(versionId) ?? []).map((event) => cloneAuditEvent(event));
  }

  async getDiagnostics(assetId: string, versionId: string): Promise<VersionDiagnostics | null> {
    const record = this.versions.get(this.buildKey(assetId, versionId));
    return record ? cloneDiagnostics(record) : null;
  }

  async reprocessVersion(
    assetId: string,
    versionId: string,
    actorSubject: string
  ): Promise<OperatorActionAccepted> {
    const record = this.getMutableVersion(assetId, versionId);

    if (!['canonical', 'published', 'failed_retryable'].includes(record.lifecycleState)) {
      throw new OperatorActionRejectedError('reprocess', assetId, versionId, record.lifecycleState);
    }

    const operationId = this.generateId('op');
    const workflowId = `${assetId}:${versionId}:reprocess:${operationId}`;
    record.lifecycleState = 'processing';
    record.workflow = {
      state: 'queued',
      workflowId
    };
    this.recordAudit('reprocess', assetId, versionId, actorSubject, operationId, workflowId);

    return {
      action: 'reprocess',
      operationId,
      state: 'accepted',
      workflowId
    };
  }

  async quarantineVersion(
    assetId: string,
    versionId: string,
    actorSubject: string
  ): Promise<OperatorActionAccepted> {
    const record = this.getMutableVersion(assetId, versionId);

    if (record.lifecycleState === 'quarantined' || record.lifecycleState === 'purged') {
      throw new OperatorActionRejectedError('quarantine', assetId, versionId, record.lifecycleState);
    }

    const operationId = this.generateId('op');
    record.lifecycleState = 'quarantined';
    record.workflow = {
      state: 'waiting',
      ...(record.workflow.workflowId ? { workflowId: record.workflow.workflowId } : {})
    };
    this.recordAudit('quarantine', assetId, versionId, actorSubject, operationId);

    return {
      action: 'quarantine',
      operationId,
      state: 'accepted'
    };
  }

  async releaseVersion(
    assetId: string,
    versionId: string,
    actorSubject: string
  ): Promise<OperatorActionAccepted> {
    const record = this.getMutableVersion(assetId, versionId);

    if (record.lifecycleState !== 'quarantined') {
      throw new OperatorActionRejectedError('release', assetId, versionId, record.lifecycleState);
    }

    const operationId = this.generateId('op');
    const workflowId = `${assetId}:${versionId}:release:${operationId}`;
    record.lifecycleState = 'processing';
    record.workflow = {
      state: 'queued',
      workflowId
    };
    this.recordAudit('release', assetId, versionId, actorSubject, operationId, workflowId);

    return {
      action: 'release',
      operationId,
      state: 'accepted',
      workflowId
    };
  }

  async purgeVersion(
    assetId: string,
    versionId: string,
    actorSubject: string
  ): Promise<OperatorActionAccepted> {
    const record = this.getMutableVersion(assetId, versionId);

    if (record.lifecycleState === 'purged') {
      throw new OperatorActionRejectedError('purge', assetId, versionId, record.lifecycleState);
    }

    const operationId = this.generateId('op');
    record.lifecycleState = 'purged';
    record.workflow = {
      state: 'cancelled',
      ...(record.workflow.workflowId ? { workflowId: record.workflow.workflowId } : {})
    };
    this.recordAudit('purge', assetId, versionId, actorSubject, operationId);

    return {
      action: 'purge',
      operationId,
      state: 'accepted'
    };
  }

  private buildKey(assetId: string, versionId: string) {
    return `${assetId}:${versionId}`;
  }

  private getMutableVersion(assetId: string, versionId: string): OperatorVersionRecord {
    const record = this.versions.get(this.buildKey(assetId, versionId));

    if (!record) {
      throw new OperatorVersionNotFoundError(assetId, versionId);
    }

    return record;
  }

  private recordAudit(
    action: OperatorAction,
    assetId: string,
    versionId: string,
    actorSubject: string,
    operationId: string,
    workflowId?: string
  ) {
    const events = this.auditEvents.get(versionId) ?? [];
    events.push({
      action,
      actorSubject,
      assetId,
      operationId,
      recordedAt: this.now(),
      versionId,
      ...(workflowId ? { workflowId } : {})
    });
    this.auditEvents.set(versionId, events);
  }
}
