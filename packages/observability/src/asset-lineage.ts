/**
 * Purpose: Defines structured lineage and audit-style event recording for asset versions so operator diagnostics can correlate lifecycle checkpoints consistently.
 * Governing docs:
 * - docs/observability.md
 * - docs/security-model.md
 * - docs/traceability.md
 * External references:
 * - https://opentelemetry.io/docs/languages/js/
 * - https://www.w3.org/TR/trace-context/
 * Tests:
 * - packages/observability/test/observability.test.mjs
 */

export type AssetLineageCheckpoint =
  | 'upload-session-created'
  | 'canonicalized'
  | 'workflow-started'
  | 'manifest-published'
  | 'quarantined'
  | 'released'
  | 'purged'
  | 'reprocess-requested';

export interface AssetLineageEvent {
  assetId: string;
  checkpoint: AssetLineageCheckpoint;
  namespace: string;
  outcome: 'accepted' | 'completed' | 'failed';
  recordedAt: Date;
  requestId?: string;
  service: string;
  versionId: string;
  workflowId?: string;
}

export interface AssetLineageRecorder {
  listVersionEvents(versionId: string): Promise<AssetLineageEvent[]>;
  record(event: AssetLineageEvent): Promise<void>;
}

function cloneEvent(event: AssetLineageEvent): AssetLineageEvent {
  return {
    assetId: event.assetId,
    checkpoint: event.checkpoint,
    namespace: event.namespace,
    outcome: event.outcome,
    recordedAt: new Date(event.recordedAt),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    service: event.service,
    versionId: event.versionId,
    ...(event.workflowId ? { workflowId: event.workflowId } : {})
  };
}

export class InMemoryAssetLineageRecorder implements AssetLineageRecorder {
  private readonly events: AssetLineageEvent[] = [];

  async listVersionEvents(versionId: string): Promise<AssetLineageEvent[]> {
    return this.events
      .filter((event) => event.versionId === versionId)
      .sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime())
      .map((event) => cloneEvent(event));
  }

  async record(event: AssetLineageEvent): Promise<void> {
    this.events.push(cloneEvent(event));
  }
}
