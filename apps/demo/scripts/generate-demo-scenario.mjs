import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createApiApp,
  InMemoryPublicVersionReadStore,
  InMemoryUploadSessionIssuanceStore,
  registerDeliveryRoutes,
  registerUploadSessionRoutes
} from '../../api/dist/index.js';
import {
  buildBearerHeaders,
  createInMemoryCDNgineAuth
} from '../../../packages/auth/dist/index.js';
import {
  InMemoryImagePublicationStore,
  InMemoryPresentationPublicationStore
} from '../../../packages/registry/dist/index.js';
import {
  canonicalSourceEvidenceToSnapshotResult
} from '../../../packages/storage/dist/index.js';
import {
  runImagePublicationWorkflow,
  runPresentationPublicationWorkflow
} from '../../../packages/workflows/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const generatedScenarioPath = join(__dirname, '..', 'src', 'demo-scenario.generated.json');
const demoEnvPath = join(__dirname, '..', '.env');
const demoEnvLocalPath = join(__dirname, '..', '.env.local');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .reduce((entries, line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return entries;
      }

      const separatorIndex = trimmedLine.indexOf('=');

      if (separatorIndex === -1) {
        return entries;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      let value = trimmedLine.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key) {
        entries[key] = value;
      }

      return entries;
    }, {});
}

function resolveDemoStorageConfig() {
  const fileEnv = {
    ...parseEnvFile(demoEnvPath),
    ...parseEnvFile(demoEnvLocalPath)
  };
  const envValue = (key) => process.env[key] ?? fileEnv[key];
  const bucketPrefix = envValue('CDNGINE_DEMO_BUCKET_PREFIX') ?? 'cdngine-demo';
  const configuredBuckets = {
    derived: envValue('CDNGINE_DEMO_DERIVED_BUCKET'),
    exports: envValue('CDNGINE_DEMO_EXPORTS_BUCKET'),
    ingest: envValue('CDNGINE_DEMO_INGEST_BUCKET'),
    source: envValue('CDNGINE_DEMO_SOURCE_BUCKET')
  };
  const configuredKeys = Object.entries(configuredBuckets)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  return {
    autoCreatedBuckets: configuredKeys.length < Object.keys(configuredBuckets).length,
    bucketPrefix,
    buckets: {
      derived: configuredBuckets.derived ?? `${bucketPrefix}-derived`,
      exports: configuredBuckets.exports ?? `${bucketPrefix}-exports`,
      ingest: configuredBuckets.ingest ?? `${bucketPrefix}-ingest`,
      source: configuredBuckets.source ?? `${bucketPrefix}-source`
    },
    configurationSource:
      configuredKeys.length === 0
        ? 'auto-created-defaults'
        : configuredKeys.length === Object.keys(configuredBuckets).length
          ? 'environment'
          : 'mixed',
    configuredBucketKeys: configuredKeys
  };
}

function resolveDemoEnvironmentOptions() {
  const fileEnv = {
    ...parseEnvFile(demoEnvPath),
    ...parseEnvFile(demoEnvLocalPath)
  };
  const envValue = (key) => process.env[key] ?? fileEnv[key];

  return {
    apiBaseUrl: envValue('CDNGINE_DEMO_API_BASE_URL') ?? 'https://api.cdngine.local',
    demoUrl: envValue('CDNGINE_DEMO_URL') ?? 'http://localhost:5173'
  };
}

class DemoStagingBlobStore {
  constructor(descriptors) {
    this.descriptors = new Map(Object.entries(descriptors));
  }

  async createUploadTarget(input) {
    return {
      expiresAt: input.expiresAt.toISOString(),
      headers: {},
      method: 'PATCH',
      url: `https://uploads.cdngine.local/${input.objectKey}`
    };
  }

  async headObject(objectKey) {
    return this.descriptors.get(objectKey) ?? null;
  }
}

class DemoSourceRepository {
  async snapshotFromPath(input) {
    return {
      repositoryEngine: 'kopia',
      canonicalSourceId: `src_${input.assetVersionId}`,
      digests: [
        {
          algorithm: 'sha256',
          value: `sha-${input.assetVersionId}`
        }
      ],
      logicalPath: `source/${input.metadata.serviceNamespaceId}/${input.metadata.assetId}/${input.assetVersionId}/original/${input.sourceFilename}`,
      snapshotId: `snap_${input.assetVersionId}`
    };
  }
}

class DemoDerivedObjectStore {
  constructor(bucket = 'cdngine-derived') {
    this.bucket = bucket;
  }

  async publishObject(input) {
    return {
      bucket: this.bucket,
      key: `derived/${input.objectKey}`
    };
  }
}

function createIdGenerator() {
  const counters = new Map();

  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(3, '0')}`;
  };
}

function actorHeaders(accessToken) {
  return {
    ...buildBearerHeaders(accessToken),
    'content-type': 'application/json'
  };
}

async function requestJson(app, url, options = {}) {
  const response = await app.request(url, options);
  const text = await response.text();

  return {
    payload: text ? JSON.parse(text) : null,
    response
  };
}

function buildImageProcessorActivity() {
  return {
    async processDerivative(input) {
      const body = JSON.stringify({
        canonicalSourceId: input.canonicalSourceId,
        recipeId: input.recipeBinding.recipeId
      });

      return {
        body,
        byteLength: BigInt(Buffer.byteLength(body)),
        contentType: input.recipeBinding.contentType
      };
    }
  };
}

function buildPresentationProcessorActivity() {
  return {
    async processPresentation(input) {
      const normalizedBody = JSON.stringify({
        canonicalSourceId: input.canonicalSourceId,
        variantKey: 'normalized-pdf'
      });
      const slideOneBody = JSON.stringify({
        canonicalSourceId: input.canonicalSourceId,
        variantKey: 'slide-001'
      });
      const slideTwoBody = JSON.stringify({
        canonicalSourceId: input.canonicalSourceId,
        variantKey: 'slide-002'
      });

      return {
        normalizedDocument: {
          body: normalizedBody,
          byteLength: BigInt(Buffer.byteLength(normalizedBody)),
          contentType: 'application/pdf'
        },
        slides: [
          {
            body: slideOneBody,
            byteLength: BigInt(Buffer.byteLength(slideOneBody)),
            contentType: 'image/webp',
            pageNumber: 1
          },
          {
            body: slideTwoBody,
            byteLength: BigInt(Buffer.byteLength(slideTwoBody)),
            contentType: 'image/webp',
            pageNumber: 2
          }
        ]
      };
    }
  };
}

function getPersistedCanonicalSourceSnapshot(uploadStore, versionId) {
  const persistedVersion = uploadStore.getPersistedVersion(versionId);

  if (!persistedVersion?.canonicalSourceEvidence) {
    throw new Error(`Version "${versionId}" is missing persisted canonical-source evidence.`);
  }

  return canonicalSourceEvidenceToSnapshotResult(persistedVersion.canonicalSourceEvidence);
}

function toPublicVersionSeed(version, workflowResult, deliveryScopeId, storageConfig) {
  return {
    assetId: version.assetId,
    assetOwner: version.assetOwner,
    defaultManifestType: workflowResult.manifest.manifestType,
    deliveries: workflowResult.derivatives.map((derivative, index) => ({
      assetId: version.assetId,
      byteLength: derivative.byteLength,
      contentType: derivative.contentType,
      deliveryScopeId,
      deterministicKey: derivative.deterministicKey,
      derivativeId: `drv_${version.versionId}_${String(index + 1).padStart(3, '0')}`,
      recipeId: derivative.recipeId,
      storageKey: derivative.storageKey,
      variant: derivative.variantKey,
      versionId: version.versionId
    })),
    lifecycleState: 'published',
    manifests: [
      {
        assetId: version.assetId,
        deliveryScopeId,
        manifestPayload: workflowResult.manifest.manifestPayload,
        manifestType: workflowResult.manifest.manifestType,
        objectKey: workflowResult.manifest.objectKey,
        versionId: version.versionId
      }
    ],
    serviceNamespaceId: version.serviceNamespaceId,
    source: {
      byteLength: version.source.byteLength,
      contentType: version.source.contentType,
      filename: version.source.filename
    },
    sourceAuthorization: {
      authorizationMode: 'signed-url',
      expiresAt: new Date('2026-01-15T19:00:00.000Z'),
      resolvedOrigin: 'source-export',
      ...(version.tenantId ? { tenantId: version.tenantId } : {}),
      url: `https://downloads.cdngine.local/${storageConfig.buckets.exports}/${version.assetId}/${version.versionId}`
    },
    ...(version.tenantId ? { tenantId: version.tenantId } : {}),
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    workflowState: 'completed'
  };
}

const architectureComponents = [
  {
    componentId: 'api-edge',
    label: 'API edge / auth',
    layer: 'control-plane',
    responsibility: 'Authenticates the caller, enforces tenant and namespace scope, and emits request correlation.'
  },
  {
    componentId: 'registry',
    label: 'Registry metadata',
    layer: 'control-plane',
    responsibility: 'Resolves immutable asset-version metadata, manifests, and delivery authorization context.'
  },
  {
    componentId: 'ingest-staging',
    label: 'tusd staging',
    layer: 'ingest',
    responsibility: 'Accepts resumable upload bytes before canonicalization turns them into durable source truth.'
  },
  {
    componentId: 'canonical-source-repo',
    label: 'Canonical source repository',
    layer: 'source-plane',
    responsibility: 'Stores immutable source truth and reconstruction evidence for replay and source-export flows.'
  },
  {
    componentId: 'workflow-controller',
    label: 'Temporal workflow dispatch',
    layer: 'orchestration',
    responsibility: 'Starts publication workflows and tracks long-running processing state.'
  },
  {
    componentId: 'worker-cache',
    label: 'Worker hot cache',
    layer: 'processing',
    responsibility: 'Accelerates repeated source reads close to compute during publication and replay.'
  },
  {
    componentId: 'derived-hot-origin',
    label: 'Derived hot origin',
    layer: 'delivery',
    responsibility: 'Stores current published derivatives and manifests for low-latency origin fetches.'
  },
  {
    componentId: 'cold-origin-tier',
    label: 'Cold origin media',
    layer: 'delivery',
    responsibility: 'Holds demoted derivative objects until a cold read triggers rehydration back into hot origin storage.'
  },
  {
    componentId: 'source-export',
    label: 'Source export materialization',
    layer: 'delivery',
    responsibility: 'Materializes authorized original-source downloads from the canonical source plane.'
  },
  {
    componentId: 'cdn-edge',
    label: 'CDN edge',
    layer: 'delivery',
    responsibility: 'Serves hot derivatives directly and refills from origin on cache misses.'
  }
];

const storageProfileDefinitions = [
  {
    profileId: 'standard-tiering',
    label: 'Standard tiering',
    description:
      'Uses realistic hot and warm windows before lifecycle policy demotes the origin copy to cold media.',
    demotionPolicy: {
      hotWindowSeconds: 900,
      warmWindowSeconds: 3600,
      coldAfterSeconds: 14400
    },
    restoreProfile: {
      cacheFillMs: 160,
      label: 'Realistic restore',
      restoreBaseMs: 900,
      restoreSizeFactorMs: 85
    },
    hitRates: {
      cdnEdge: 0.93,
      hotOrigin: 0.79
    }
  },
  {
    profileId: 'instant-cold-demo',
    label: 'Accelerated cold demo',
    description:
      'Compresses the hot and warm windows and makes cold restores nearly instant so the architecture can be demonstrated interactively.',
    demotionPolicy: {
      hotWindowSeconds: 15,
      warmWindowSeconds: 30,
      coldAfterSeconds: 45
    },
    restoreProfile: {
      cacheFillMs: 35,
      label: 'Instant restore',
      restoreBaseMs: 25,
      restoreSizeFactorMs: 4
    },
    hitRates: {
      cdnEdge: 0.42,
      hotOrigin: 0.31
    }
  }
];

function round(value) {
  return Math.round(value);
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function withOffsets(events) {
  let offsetMs = 0;

  return events.map((event) => {
    const timedEvent = {
      ...event,
      offsetMs
    };
    offsetMs += event.durationMs;
    return timedEvent;
  });
}

function buildTraceScenario({ objectState, profile, traceType, cacheOutcome, summary, events }) {
  const timedEvents = withOffsets(events);
  const lastEvent = timedEvents[timedEvents.length - 1];
  const totalMs = lastEvent ? lastEvent.offsetMs + lastEvent.durationMs : 0;

  return {
    cacheOutcome,
    objectKey: objectState.objectKey,
    profileId: profile.profileId,
    summary,
    title: objectState.title,
    totalMs,
    traceId: `${profile.profileId}:${objectState.objectKey}:${traceType}`,
    traceType,
    events: timedEvents
  };
}

function buildObjectState(object, profile) {
  const sizeMb = Math.max(object.source.byteLength / 1_000_000, 0.1);
  const isPresentation = object.source.contentType === 'application/pdf';
  const manifestMs = round(8 + sizeMb * 2);
  const publicationMs = round((isPresentation ? 520 : 260) + sizeMb * (isPresentation ? 110 : 45));
  const hotDeliveryMs = round((isPresentation ? 28 : 18) + sizeMb * 16);
  const coldRestoreMs = round(
    profile.restoreProfile.restoreBaseMs + sizeMb * profile.restoreProfile.restoreSizeFactorMs
  );
  const coldDeliveryMs = hotDeliveryMs + coldRestoreMs + profile.restoreProfile.cacheFillMs;
  const sourceExportMs = round(130 + sizeMb * 28 + coldRestoreMs * 0.45);
  const objectKey = `${object.assetId}:${object.versionId}`;

  const publicationTrace = buildTraceScenario({
    objectState: {
      objectKey,
      title: object.title
    },
    profile,
    traceType: 'publication',
    cacheOutcome: 'workflow-publish',
    summary: 'Upload lands in staging, canonicalizes into source truth, and publishes deterministic delivery outputs.',
    events: [
      {
        action: 'Issue upload session, authenticate caller, and validate idempotency.',
        componentId: 'api-edge',
        durationMs: round(9 + sizeMb * 2),
        storageState: 'control-plane'
      },
      {
        action: 'Receive resumable upload bytes in staging.',
        componentId: 'ingest-staging',
        durationMs: round(18 + sizeMb * 8),
        storageState: 'staging'
      },
      {
        action: 'Snapshot immutable source bytes into the canonical repository.',
        componentId: 'canonical-source-repo',
        durationMs: round(40 + sizeMb * 18),
        storageState: 'canonical-hot'
      },
      {
        action: 'Dispatch the publication workflow.',
        componentId: 'workflow-controller',
        durationMs: round(12 + sizeMb * 2),
        storageState: 'queued'
      },
      {
        action: 'Read source data through the worker-side hot cache during processing.',
        componentId: 'worker-cache',
        durationMs: round(50 + sizeMb * (isPresentation ? 35 : 20)),
        storageState: 'worker-hot'
      },
      {
        action: 'Write deterministic derivatives and the manifest into hot origin storage.',
        componentId: 'derived-hot-origin',
        durationMs: round(80 + sizeMb * (isPresentation ? 50 : 22)),
        storageState: 'origin-hot'
      }
    ]
  });

  const hotDeliveryTrace = buildTraceScenario({
    objectState: {
      objectKey,
      title: object.title
    },
    profile,
    traceType: 'hot-delivery',
    cacheOutcome: 'edge-hit',
    summary: 'Published derivative is still hot, so the CDN serves it directly after authorization and metadata lookup.',
    events: [
      {
        action: 'Authorize delivery URL and enforce scope.',
        componentId: 'api-edge',
        durationMs: round(6 + sizeMb * 1),
        storageState: 'control-plane'
      },
      {
        action: 'Resolve delivery metadata and manifest context.',
        componentId: 'registry',
        durationMs: round(8 + manifestMs),
        storageState: 'metadata-hot'
      },
      {
        action: 'Serve the derivative from the CDN edge cache.',
        componentId: 'cdn-edge',
        durationMs: round(Math.max(hotDeliveryMs - manifestMs - 12, 8)),
        storageState: 'edge-hot'
      }
    ]
  });

  const coldDeliveryTrace = buildTraceScenario({
    objectState: {
      objectKey,
      title: object.title
    },
    profile,
    traceType: 'cold-delivery',
    cacheOutcome: profile.profileId === 'instant-cold-demo' ? 'instant-restore' : 'cold-restore',
    summary:
      'The CDN misses, the hot origin copy has already been demoted, and the colder origin tier rehydrates the object before the edge is refilled.',
    events: [
      {
        action: 'Authorize delivery URL and enforce scope.',
        componentId: 'api-edge',
        durationMs: round(6 + sizeMb * 1),
        storageState: 'control-plane'
      },
      {
        action: 'Resolve immutable version metadata and derivative binding.',
        componentId: 'registry',
        durationMs: round(10 + manifestMs),
        storageState: 'metadata-hot'
      },
      {
        action: 'CDN edge misses because the hot window has expired.',
        componentId: 'cdn-edge',
        durationMs: 12,
        storageState: 'edge-miss'
      },
      {
        action: 'Hot origin checks for the derivative and finds it demoted.',
        componentId: 'derived-hot-origin',
        durationMs: 14,
        storageState: 'origin-cold-miss'
      },
      {
        action: `${profile.restoreProfile.label} from colder origin media back into hot origin storage.`,
        componentId: 'cold-origin-tier',
        durationMs: coldRestoreMs,
        storageState: 'cold-restore'
      },
      {
        action: 'Refill the hot origin copy.',
        componentId: 'derived-hot-origin',
        durationMs: round(profile.restoreProfile.cacheFillMs * 0.55),
        storageState: 'origin-rehydrated'
      },
      {
        action: 'Refill the CDN edge and serve the request.',
        componentId: 'cdn-edge',
        durationMs: round(profile.restoreProfile.cacheFillMs * 0.45 + hotDeliveryMs),
        storageState: 'edge-refill'
      }
    ]
  });

  const sourceExportTrace = buildTraceScenario({
    objectState: {
      objectKey,
      title: object.title
    },
    profile,
    traceType: 'source-export',
    cacheOutcome: 'source-materialization',
    summary:
      'The authorized original-source download reconstructs from canonical truth and materializes a short-lived export.',
    events: [
      {
        action: 'Authorize original-source access and enforce scope.',
        componentId: 'api-edge',
        durationMs: round(7 + sizeMb * 1),
        storageState: 'control-plane'
      },
      {
        action: 'Resolve source-export authorization context.',
        componentId: 'registry',
        durationMs: round(10 + manifestMs),
        storageState: 'metadata-hot'
      },
      {
        action: 'Restore original bytes from the canonical source repository.',
        componentId: 'canonical-source-repo',
        durationMs: round(coldRestoreMs * 0.65),
        storageState: 'canonical-read'
      },
      {
        action: 'Materialize a short-lived export object.',
        componentId: 'source-export',
        durationMs: round(sourceExportMs * 0.35),
        storageState: 'export-hot'
      }
    ]
  });

  return {
    assetId: object.assetId,
    contentType: object.source.contentType,
    lifecycleTimeline: [
      {
        componentId: 'ingest-staging',
        label: 'Upload bytes arrive in staging.',
        offsetSeconds: 0,
        storageState: 'staging'
      },
      {
        componentId: 'canonical-source-repo',
        label: 'Canonical source snapshot completes.',
        offsetSeconds: 3,
        storageState: 'canonical-hot'
      },
      {
        componentId: 'workflow-controller',
        label: 'Publication workflow is dispatched.',
        offsetSeconds: 5,
        storageState: 'queued'
      },
      {
        componentId: 'derived-hot-origin',
        label: 'Deterministic derivative is published into hot origin storage.',
        offsetSeconds: 12,
        storageState: 'origin-hot'
      },
      {
        componentId: 'cdn-edge',
        label: 'First delivery warms the CDN edge cache.',
        offsetSeconds: 18,
        storageState: 'edge-hot'
      },
      {
        componentId: 'cold-origin-tier',
        label: 'Lifecycle policy demotes the origin copy to colder storage media.',
        offsetSeconds: profile.demotionPolicy.coldAfterSeconds,
        storageState: 'origin-cold'
      },
      {
        componentId: 'cold-origin-tier',
        label: `${profile.restoreProfile.label} makes a cold-read restore observable in the demo.`,
        offsetSeconds: profile.demotionPolicy.coldAfterSeconds + 5,
        storageState: 'cold-restore'
      },
      {
        componentId: 'cdn-edge',
        label: 'The CDN is refilled after rehydration and returns to hot service.',
        offsetSeconds: profile.demotionPolicy.coldAfterSeconds + 8,
        storageState: 'edge-refilled'
      }
    ],
    metrics: {
      coldDeliveryMs,
      coldRestoreMs,
      hotDeliveryMs,
      manifestMs,
      publicationMs,
      sourceExportMs
    },
    objectKey,
    tenantId: object.tenantId,
    title: object.title,
    traces: [publicationTrace, hotDeliveryTrace, coldDeliveryTrace, sourceExportTrace],
    versionId: object.versionId
  };
}

function summarizeComponentHits(traces) {
  const componentMap = new Map(
    architectureComponents.map((component) => [
      component.componentId,
      {
        componentId: component.componentId,
        hitCount: 0,
        slowestEventMs: 0,
        totalDurationMs: 0
      }
    ])
  );

  for (const trace of traces) {
    for (const event of trace.events) {
      const summary = componentMap.get(event.componentId);

      if (!summary) {
        continue;
      }

      summary.hitCount += 1;
      summary.totalDurationMs += event.durationMs;
      summary.slowestEventMs = Math.max(summary.slowestEventMs, event.durationMs);
    }
  }

  return Array.from(componentMap.values()).filter((entry) => entry.hitCount > 0);
}

function buildStorageSimulation(generatedObjects) {
  return {
    architectureComponents,
    storageProfiles: storageProfileDefinitions.map((profile) => {
      const objectStates = generatedObjects.map((object) => buildObjectState(object, profile));
      const traces = objectStates.flatMap((objectState) => objectState.traces);

      return {
        componentHits: summarizeComponentHits(traces),
        demotionPolicy: profile.demotionPolicy,
        description: profile.description,
        label: profile.label,
        objectStates: objectStates.map(({ traces: _traces, ...objectState }) => objectState),
        profileId: profile.profileId,
        restoreProfile: profile.restoreProfile,
        summaryMetrics: {
          cdnEdgeHitRate: profile.hitRates.cdnEdge,
          coldDeliveryMs: round(average(objectStates.map((objectState) => objectState.metrics.coldDeliveryMs))),
          coldRestoreMs: round(average(objectStates.map((objectState) => objectState.metrics.coldRestoreMs))),
          hotDeliveryMs: round(average(objectStates.map((objectState) => objectState.metrics.hotDeliveryMs))),
          hotOriginHitRate: profile.hitRates.hotOrigin,
          manifestMs: round(average(objectStates.map((objectState) => objectState.metrics.manifestMs))),
          publicationMs: round(average(objectStates.map((objectState) => objectState.metrics.publicationMs))),
          sourceExportMs: round(average(objectStates.map((objectState) => objectState.metrics.sourceExportMs)))
        },
        traces
      };
    })
  };
}

function buildUsageExamples({ apiBaseUrl, exampleObject, exampleTenant }) {
  const apiCode = `API_BASE_URL=${apiBaseUrl}
ACCESS_TOKEN=replace-with-host-access-token

curl -X POST "$API_BASE_URL/v1/upload-sessions" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: create-${exampleObject.assetId}" \\
  -d '{
    "assetOwner": "customer:acme",
    "serviceNamespaceId": "media-platform",
    "tenantId": "${exampleTenant.tenantId}",
    "source": {
      "filename": "${exampleObject.source.filename}",
      "contentType": "${exampleObject.source.contentType}"
    },
    "upload": {
      "objectKey": "ingest/media-platform/${exampleTenant.tenantId}/${exampleObject.source.filename}",
      "byteLength": ${exampleObject.source.byteLength},
      "checksum": { "algorithm": "sha256", "value": "replace-with-real-checksum" }
    }
  }'

curl -X POST "$API_BASE_URL/v1/upload-sessions/$SESSION_ID/complete" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: complete-$SESSION_ID" \\
  -d '{
    "stagedObject": {
      "objectKey": "ingest/media-platform/${exampleTenant.tenantId}/${exampleObject.source.filename}",
      "byteLength": ${exampleObject.source.byteLength},
      "checksum": { "algorithm": "sha256", "value": "replace-with-real-checksum" }
    }
  }'

curl "$API_BASE_URL/v1/assets/${exampleObject.assetId}/versions/${exampleObject.versionId}" \\
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl -X POST "$API_BASE_URL/v1/assets/${exampleObject.assetId}/versions/${exampleObject.versionId}/deliveries/${exampleObject.deliveryScopeId}/authorize" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: authorize-${exampleObject.versionId}" \\
  -d '{ "variant": "${exampleObject.downloads[0]?.label ?? 'webp-master'}", "responseFormat": "url" }'`;

const sdkCode = `import { createCDNgineClient } from "@cdngine/sdk";

const client = createCDNgineClient({
  baseUrl: "${apiBaseUrl}",
  getAccessToken: () => "replace-with-host-access-token"
});

const media = client.withDefaults({
  assetOwner: "customer:acme",
  serviceNamespaceId: "media-platform",
  tenantId: "${exampleTenant.tenantId}"
});

const fileBytes = new Uint8Array(/* file bytes go here */);

const uploaded = await media.upload(fileBytes, {
  contentType: "${exampleObject.source.contentType}",
  filename: "${exampleObject.source.filename}",
  idempotencyKey: "upload-${exampleObject.assetId}"
});

const version = client.asset(uploaded.assetId).version(uploaded.versionId);

const delivery = await version.delivery("${exampleObject.deliveryScopeId}").authorize({
  idempotencyKey: \`authorize-\${uploaded.versionId}\`,
  body: {
    variant: "${exampleObject.downloads[0]?.label ?? 'webp-master'}",
    responseFormat: "url"
  }
});

const source = await version.authorizeSourceDownload({
  idempotencyKey: \`source-\${uploaded.versionId}\`,
  body: {
    preferredDisposition: "attachment"
  }
});

console.log({ uploaded, delivery, source });`;

  return {
    api: {
      description: 'Raw HTTP flow using the public API surface directly.',
      language: 'bash',
      title: 'API example',
      code: apiCode
    },
    sdk: {
      description: 'TypeScript flow using the ergonomic checked-in CDNgine client surface.',
      language: 'ts',
      title: 'SDK example',
      code: sdkCode
    }
  };
}

export async function buildDemoScenario() {
  const generatedAt = '2026-01-15T19:00:00.000Z';
  const now = () => new Date(generatedAt);
  const demoEnvironment = resolveDemoEnvironmentOptions();
  const storageConfig = resolveDemoStorageConfig();
  const auth = createInMemoryCDNgineAuth({
    baseURL: demoEnvironment.apiBaseUrl
  });
  const tenantDefinitions = [
    {
      actorEmail: 'customer-acme-demo@cdngine.test',
      actorSubject: 'customer-acme-demo',
      tenantId: 'tenant-acme',
      tenantName: 'Tenant Acme'
    },
    {
      actorEmail: 'customer-beta-demo@cdngine.test',
      actorSubject: 'customer-beta-demo',
      tenantId: 'tenant-beta',
      tenantName: 'Tenant Beta'
    }
  ];
  const tenantActors = new Map();

  for (const tenant of tenantDefinitions) {
    tenantActors.set(
      tenant.tenantId,
      await auth.provisionPrincipal({
        allowedServiceNamespaces: ['media-platform'],
        allowedTenantIds: [tenant.tenantId],
        email: tenant.actorEmail,
        name: tenant.tenantName,
        roles: ['public-user'],
        subject: tenant.actorSubject
      })
    );
  }
  const uploadStore = new InMemoryUploadSessionIssuanceStore({
    generateId: createIdGenerator(),
    now
  });
  const stagingBlobStore = new DemoStagingBlobStore({
    'ingest/media-platform/tenant-acme/event-deck.pdf': {
      bucket: storageConfig.buckets.ingest,
      checksum: {
        algorithm: 'sha256',
        value: 'deck-sha'
      },
      key: 'ingest/media-platform/tenant-acme/event-deck.pdf'
    },
    'ingest/media-platform/tenant-acme/hero-banner-v1.png': {
      bucket: storageConfig.buckets.ingest,
      checksum: {
        algorithm: 'sha256',
        value: 'hero-v1-sha'
      },
      key: 'ingest/media-platform/tenant-acme/hero-banner-v1.png'
    },
    'ingest/media-platform/tenant-acme/hero-banner-v2.png': {
      bucket: storageConfig.buckets.ingest,
      checksum: {
        algorithm: 'sha256',
        value: 'hero-v2-sha'
      },
      key: 'ingest/media-platform/tenant-acme/hero-banner-v2.png'
    },
    'ingest/media-platform/tenant-beta/brand-logo.png': {
      bucket: storageConfig.buckets.ingest,
      checksum: {
        algorithm: 'sha256',
        value: 'brand-sha'
      },
      key: 'ingest/media-platform/tenant-beta/brand-logo.png'
    }
  });
  const uploadApp = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        now,
        sourceRepository: new DemoSourceRepository(),
        stagingBlobStore,
        store: uploadStore
      });
    }
  });

  const uploadPlans = [
    {
      actorSubject: 'customer-acme-demo',
      assetKey: 'hero-banner',
      assetOwner: 'customer:acme',
      byteLength: 1843921,
      checksumValue: 'hero-v1-sha',
      contentType: 'image/png',
      deliveryScopeId: 'public-images',
      filename: 'hero-banner-v1.png',
      objectKey: 'ingest/media-platform/tenant-acme/hero-banner-v1.png',
      tenantId: 'tenant-acme',
      title: 'Hero banner v1'
    },
    {
      actorSubject: 'customer-acme-demo',
      assetKey: 'hero-banner',
      assetOwner: 'customer:acme',
      byteLength: 1910244,
      checksumValue: 'hero-v2-sha',
      contentType: 'image/png',
      deliveryScopeId: 'public-images',
      filename: 'hero-banner-v2.png',
      objectKey: 'ingest/media-platform/tenant-acme/hero-banner-v2.png',
      tenantId: 'tenant-acme',
      title: 'Hero banner v2'
    },
    {
      actorSubject: 'customer-acme-demo',
      assetKey: 'event-deck',
      assetOwner: 'customer:acme',
      byteLength: 4096,
      checksumValue: 'deck-sha',
      contentType: 'application/pdf',
      deliveryScopeId: 'presentations',
      filename: 'event-deck.pdf',
      objectKey: 'ingest/media-platform/tenant-acme/event-deck.pdf',
      tenantId: 'tenant-acme',
      title: 'Event deck'
    },
    {
      actorSubject: 'customer-beta-demo',
      assetKey: 'brand-logo',
      assetOwner: 'customer:beta',
      byteLength: 512443,
      checksumValue: 'brand-sha',
      contentType: 'image/png',
      deliveryScopeId: 'public-images',
      filename: 'brand-logo.png',
      objectKey: 'ingest/media-platform/tenant-beta/brand-logo.png',
      tenantId: 'tenant-beta',
      title: 'Brand logo'
    }
  ];

  const assetIdsByKey = new Map();
  const versionNumbersByAssetKey = new Map();
  const generatedVersions = [];
  const publicSeeds = [];

  for (const plan of uploadPlans) {
    const actor = tenantActors.get(plan.tenantId);
    const headers = actorHeaders(actor.token);
    const createBody = {
      assetOwner: plan.assetOwner,
      serviceNamespaceId: 'media-platform',
      source: {
        contentType: plan.contentType,
        filename: plan.filename
      },
      tenantId: plan.tenantId,
      upload: {
        byteLength: plan.byteLength,
        checksum: {
          algorithm: 'sha256',
          value: plan.checksumValue
        },
        objectKey: plan.objectKey
      },
      ...(assetIdsByKey.has(plan.assetKey) ? { assetId: assetIdsByKey.get(plan.assetKey) } : {})
    };
    const createResult = await requestJson(uploadApp, 'http://localhost/v1/upload-sessions', {
      method: 'POST',
      headers: {
        ...headers,
        'idempotency-key': `create-${plan.assetKey}-${plan.checksumValue}`
      },
      body: JSON.stringify(createBody)
    });
    const created = createResult.payload;

    if (!assetIdsByKey.has(plan.assetKey)) {
      assetIdsByKey.set(plan.assetKey, created.assetId);
    }

    const versionNumber = (versionNumbersByAssetKey.get(plan.assetKey) ?? 0) + 1;
    versionNumbersByAssetKey.set(plan.assetKey, versionNumber);

    const completeResult = await requestJson(
      uploadApp,
      `http://localhost/v1/upload-sessions/${created.uploadSessionId}/complete`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': `complete-${plan.assetKey}-${plan.checksumValue}`
        },
        body: JSON.stringify({
          stagedObject: {
            byteLength: plan.byteLength,
            checksum: {
              algorithm: 'sha256',
              value: plan.checksumValue
            },
            objectKey: plan.objectKey
          }
        })
      }
    );
    const completed = completeResult.payload;
    const canonicalSource = getPersistedCanonicalSourceSnapshot(uploadStore, completed.versionId);
    const version = {
      assetId: completed.assetId,
      assetOwner: plan.assetOwner,
      serviceNamespaceId: 'media-platform',
      source: {
        byteLength: BigInt(plan.byteLength),
        contentType: plan.contentType,
        filename: plan.filename
      },
      tenantId: plan.tenantId,
      uploadSessionId: created.uploadSessionId,
      versionId: completed.versionId,
      versionNumber,
      workflowDispatch: completed.workflowDispatch
    };

    let workflowResult;

    if (plan.contentType === 'application/pdf') {
      workflowResult = await runPresentationPublicationWorkflow(
        {
          deliveryScopeId: plan.deliveryScopeId,
          versionId: version.versionId,
          workflowId: completed.workflowDispatch.workflowKey
        },
        {
          derivedObjectStore: new DemoDerivedObjectStore(storageConfig.buckets.derived),
          now,
          processorActivity: buildPresentationProcessorActivity(),
          publicationStore: new InMemoryPresentationPublicationStore({
            versions: [
              {
                assetId: version.assetId,
                canonicalLogicalPath: canonicalSource.logicalPath,
                canonicalSourceId: canonicalSource.canonicalSourceId,
                detectedContentType: plan.contentType,
                serviceNamespaceId: 'media-platform',
                sourceByteLength: canonicalSource.logicalByteLength ?? BigInt(plan.byteLength),
                sourceChecksumValue:
                  canonicalSource.digests.find((digest) => digest.algorithm === 'sha256')?.value ??
                  plan.checksumValue,
                sourceFilename: plan.filename,
                versionId: version.versionId,
                versionNumber: version.versionNumber
              }
            ]
          })
        }
      );
    } else {
      workflowResult = await runImagePublicationWorkflow(
        {
          deliveryScopeId: plan.deliveryScopeId,
          versionId: version.versionId,
          workflowId: completed.workflowDispatch.workflowKey
        },
        {
          derivedObjectStore: new DemoDerivedObjectStore(storageConfig.buckets.derived),
          now,
          processorActivity: buildImageProcessorActivity(),
          publicationStore: new InMemoryImagePublicationStore({
            versions: [
              {
                assetId: version.assetId,
                canonicalLogicalPath: canonicalSource.logicalPath,
                canonicalSourceId: canonicalSource.canonicalSourceId,
                detectedContentType: plan.contentType,
                serviceNamespaceId: 'media-platform',
                sourceByteLength: canonicalSource.logicalByteLength ?? BigInt(plan.byteLength),
                sourceChecksumValue:
                  canonicalSource.digests.find((digest) => digest.algorithm === 'sha256')?.value ??
                  plan.checksumValue,
                sourceFilename: plan.filename,
                versionId: version.versionId,
                versionNumber: version.versionNumber
              }
            ]
          })
        }
      );
    }

    publicSeeds.push(toPublicVersionSeed(version, workflowResult, plan.deliveryScopeId, storageConfig));
    generatedVersions.push({
      deliveryScopeId: plan.deliveryScopeId,
      tenantId: plan.tenantId,
      title: plan.title,
      version,
      workflowResult
    });
  }

  const publicApp = createApiApp({
    auth,
    registerPublicRoutes(publicRouteApp) {
      registerDeliveryRoutes(publicRouteApp, {
        now,
        store: new InMemoryPublicVersionReadStore({
          versions: publicSeeds
        })
      });
    }
  });

  const generatedObjects = [];

  for (const item of generatedVersions) {
    const actor = tenantActors.get(item.tenantId);
    const headers = actorHeaders(actor.token);
    const versionResult = await requestJson(
      publicApp,
      `http://localhost/v1/assets/${item.version.assetId}/versions/${item.version.versionId}`,
      { headers }
    );
    const derivative = item.workflowResult.derivatives[0];
    const deliveryResult = await requestJson(
      publicApp,
      `http://localhost/v1/assets/${item.version.assetId}/versions/${item.version.versionId}/deliveries/${item.deliveryScopeId}/authorize`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': `delivery-${item.version.versionId}`
        },
        body: JSON.stringify({
          responseFormat: 'url',
          variant: derivative.variantKey
        })
      }
    );
    const sourceResult = await requestJson(
      publicApp,
      `http://localhost/v1/assets/${item.version.assetId}/versions/${item.version.versionId}/source/authorize`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': `source-${item.version.versionId}`
        },
        body: JSON.stringify({
          preferredDisposition: 'attachment'
        })
      }
    );

    generatedObjects.push({
      assetId: item.version.assetId,
      deliveryScopeId: item.deliveryScopeId,
      lifecycleState: versionResult.payload.lifecycleState,
      manifestType: item.workflowResult.manifest.manifestType,
      objectKey: `${item.version.assetId}:${item.version.versionId}`,
      source: {
        byteLength: Number(item.version.source.byteLength),
        contentType: item.version.source.contentType,
        filename: item.version.source.filename
      },
      tenantId: item.tenantId,
      title: item.title,
      uploadSessionId: item.version.uploadSessionId,
      versionId: item.version.versionId,
      versionNumber: item.version.versionNumber,
      workflowKey: item.version.workflowDispatch.workflowKey,
      downloads: [
        {
          kind: 'derivative',
          label: derivative.variantKey,
          resolvedOrigin: deliveryResult.payload.resolvedOrigin,
          url: deliveryResult.payload.url
        },
        {
          kind: 'source',
          label: 'original source',
          resolvedOrigin: sourceResult.payload.resolvedOrigin,
          url: sourceResult.payload.url
        }
      ]
    });
  }

  const denialResult = await requestJson(
    publicApp,
    `http://localhost/v1/assets/${generatedVersions[0].version.assetId}/versions/${generatedVersions[0].version.versionId}`,
    {
      headers: actorHeaders(tenantActors.get('tenant-beta').token)
    }
  );

  return {
    crossTenantDenial: {
      actorTenantId: 'tenant-beta',
      detail: denialResult.payload.detail,
      status: denialResult.response.status,
      targetTenantId: generatedVersions[0].tenantId,
      type: denialResult.payload.type
    },
    environment: {
      apiBaseUrl: demoEnvironment.apiBaseUrl,
      demoUrl: demoEnvironment.demoUrl,
      storage: storageConfig
    },
    examples: buildUsageExamples({
      apiBaseUrl: demoEnvironment.apiBaseUrl,
      exampleObject: generatedObjects[0],
      exampleTenant: tenantDefinitions[0]
    }),
    generatedAt,
    generatedObjects,
    simulation: buildStorageSimulation(generatedObjects),
    tenants: tenantDefinitions.map((tenant) => {
      const actor = tenantActors.get(tenant.tenantId);

      return {
        actorEmail: tenant.actorEmail,
        actorSubject: tenant.actorSubject,
        allowedServiceNamespaces: actor.actor.allowedServiceNamespaces,
        allowedTenantIds: actor.actor.allowedTenantIds,
        roles: actor.actor.roles,
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        tokenPreview: `${actor.token.slice(0, 16)}...`
      };
    })
  };
}

async function main() {
  const scenario = await buildDemoScenario();
  mkdirSync(dirname(generatedScenarioPath), { recursive: true });
  writeFileSync(generatedScenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
