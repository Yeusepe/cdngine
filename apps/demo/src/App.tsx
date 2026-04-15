import { useMemo, useState } from "react"

import { Pattern } from "@/components/examples/c-file-upload-6"
import scenario from "./demo-scenario.generated.json"

interface DemoDownload {
  kind: string
  label: string
  resolvedOrigin: string
  url: string
}

interface DemoObject {
  assetId: string
  deliveryScopeId: string
  downloads: DemoDownload[]
  lifecycleState: string
  manifestType: string
  objectKey: string
  source: {
    byteLength: number
    contentType: string
    filename: string
  }
  tenantId: string
  title: string
  uploadSessionId: string
  versionId: string
  versionNumber: number
  workflowKey: string
}

interface DemoTenant {
  actorEmail: string
  actorSubject: string
  allowedServiceNamespaces: string[]
  allowedTenantIds: string[]
  roles: string[]
  tenantId: string
  tenantName: string
  tokenPreview: string
}

interface DemoArchitectureComponent {
  componentId: string
  label: string
  layer: string
  responsibility: string
}

interface DemoTraceEvent {
  action: string
  componentId: string
  durationMs: number
  offsetMs: number
  storageState: string
}

interface DemoTrace {
  cacheOutcome: string
  events: DemoTraceEvent[]
  objectKey: string
  profileId: string
  summary: string
  title: string
  totalMs: number
  traceId: string
  traceType: string
}

interface DemoObjectState {
  assetId: string
  contentType: string
  lifecycleTimeline: Array<{
    componentId: string
    label: string
    offsetSeconds: number
    storageState: string
  }>
  metrics: {
    coldDeliveryMs: number
    coldRestoreMs: number
    hotDeliveryMs: number
    manifestMs: number
    publicationMs: number
    sourceExportMs: number
  }
  objectKey: string
  tenantId: string
  title: string
  versionId: string
}

interface DemoProfile {
  componentHits: Array<{
    componentId: string
    hitCount: number
    slowestEventMs: number
    totalDurationMs: number
  }>
  demotionPolicy: {
    coldAfterSeconds: number
    hotWindowSeconds: number
    warmWindowSeconds: number
  }
  description: string
  label: string
  objectStates: DemoObjectState[]
  profileId: string
  restoreProfile: {
    cacheFillMs: number
    label: string
    restoreBaseMs: number
    restoreSizeFactorMs: number
  }
  summaryMetrics: {
    cdnEdgeHitRate: number
    coldDeliveryMs: number
    coldRestoreMs: number
    hotDeliveryMs: number
    hotOriginHitRate: number
    manifestMs: number
    publicationMs: number
    sourceExportMs: number
  }
  traces: DemoTrace[]
}

interface DemoScenario {
  crossTenantDenial: {
    actorTenantId: string
    detail: string
    status: number
    targetTenantId: string
    type: string
  }
  environment: {
    apiBaseUrl: string
    demoUrl: string
    storage: {
      autoCreatedBuckets: boolean
      bucketPrefix: string
      buckets: Record<string, string>
      configurationSource: string
      configuredBucketKeys: string[]
    }
  }
  examples: {
    api: {
      code: string
      description: string
      language: string
      title: string
    }
    sdk: {
      code: string
      description: string
      language: string
      title: string
    }
  }
  generatedAt: string
  generatedObjects: DemoObject[]
  simulation: {
    architectureComponents: DemoArchitectureComponent[]
    storageProfiles: DemoProfile[]
  }
  tenants: DemoTenant[]
}

const demoScenario = scenario as DemoScenario

function groupObjectsByTenant(tenants: DemoTenant[], objects: DemoObject[]) {
  return tenants.map((tenant) => ({
    ...tenant,
    objects: objects.filter((item) => item.tenantId === tenant.tenantId),
  }))
}

function buildInitialFiles(objects: DemoObject[]) {
  return objects.map((item) => ({
    id: `${item.assetId}-${item.versionId}`,
    name: item.source.filename,
    size: item.source.byteLength,
    type: item.source.contentType,
    url: item.downloads.find((download) => download.kind === "source")?.url ?? "#",
  }))
}

function formatLatency(ms: number) {
  return `${ms.toLocaleString()} ms`
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatSeconds(value: number) {
  if (value >= 3600) {
    return `${Math.round(value / 3600)}h`
  }

  if (value >= 60) {
    return `${Math.round(value / 60)}m`
  }

  return `${value}s`
}

function App() {
  const tenants = groupObjectsByTenant(demoScenario.tenants, demoScenario.generatedObjects)
  const storageProfiles = demoScenario.simulation.storageProfiles
  const architectureComponents = demoScenario.simulation.architectureComponents
  const [selectedProfileId, setSelectedProfileId] = useState(storageProfiles[0]?.profileId ?? "")
  const activeProfile = storageProfiles.find((profile) => profile.profileId === selectedProfileId) ?? storageProfiles[0]
  const [selectedObjectKey, setSelectedObjectKey] = useState(activeProfile?.objectStates[0]?.objectKey ?? "")
  const activeObjectState =
    activeProfile?.objectStates.find((objectState) => objectState.objectKey === selectedObjectKey) ??
    activeProfile?.objectStates[0]
  const [selectedTraceType, setSelectedTraceType] = useState("cold-delivery")
  const [selectedExampleMode, setSelectedExampleMode] = useState<"api" | "sdk">("api")

  const tracesForObject = useMemo(() => {
    if (!activeProfile || !activeObjectState) {
      return []
    }

    return activeProfile.traces.filter((trace) => trace.objectKey === activeObjectState.objectKey)
  }, [activeObjectState, activeProfile])

  const activeTrace =
    tracesForObject.find((trace) => trace.traceType === selectedTraceType) ??
    tracesForObject.find((trace) => trace.traceType === "cold-delivery") ??
    tracesForObject[0]
  const architectureHits = new Map(
    (activeTrace?.events ?? []).map((event, index) => [event.componentId, { ...event, order: index + 1 }]),
  )

  return (
    <main className="theme dark min-h-screen bg-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 lg:px-10">
        <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-8 shadow-2xl shadow-sky-950/30 backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <span className="inline-flex rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-sky-200">
                CDNgine architecture demo
              </span>
              <h1 className="text-4xl font-semibold tracking-tight text-white lg:text-5xl">
                Observe hot, cold, and rehydrated paths across the system.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-300 lg:text-base">
                The demo still uses the real generated multi-tenant asset flow, but now it also shows storage
                temperature changes, accelerated cold-restore mode, request-path timings, and which architectural
                components are hit during publish and delivery.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm text-slate-200 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-slate-400">Generated objects</dt>
                <dd className="mt-2 text-2xl font-semibold text-white">{demoScenario.generatedObjects.length}</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-slate-400">Tenants</dt>
                <dd className="mt-2 text-2xl font-semibold text-white">{demoScenario.tenants.length}</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-slate-400">Profiles</dt>
                <dd className="mt-2 text-2xl font-semibold text-white">{storageProfiles.length}</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-slate-400">Generated at</dt>
                <dd className="mt-2 text-sm font-medium text-white">{demoScenario.generatedAt}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-sky-950/20">
          <div className="mb-4 space-y-2">
            <h2 className="text-2xl font-semibold text-white">Storage-temperature controls</h2>
            <p className="text-sm leading-6 text-slate-300">
              Switch between the default tiering posture and an accelerated profile that demotes to cold almost
              immediately and restores nearly instantly for architecture walkthroughs.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {storageProfiles.map((profile) => {
              const isActive = activeProfile?.profileId === profile.profileId

              return (
                <button
                  key={profile.profileId}
                  className={`rounded-2xl border p-5 text-left transition ${
                    isActive
                      ? "border-sky-400/50 bg-sky-500/10 shadow-lg shadow-sky-950/20"
                      : "border-white/10 bg-black/20 hover:border-white/20"
                  }`}
                  onClick={() => setSelectedProfileId(profile.profileId)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{profile.label}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{profile.description}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
                      {profile.restoreProfile.label}
                    </span>
                  </div>
                  <dl className="mt-4 grid gap-3 text-xs text-slate-200 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <dt className="text-slate-400">Hot window</dt>
                      <dd className="mt-1 font-medium text-white">
                        {formatSeconds(profile.demotionPolicy.hotWindowSeconds)}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <dt className="text-slate-400">Cold after</dt>
                      <dd className="mt-1 font-medium text-white">
                        {formatSeconds(profile.demotionPolicy.coldAfterSeconds)}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <dt className="text-slate-400">Restore latency</dt>
                      <dd className="mt-1 font-medium text-white">
                        {formatLatency(profile.summaryMetrics.coldRestoreMs)}
                      </dd>
                    </div>
                  </dl>
                </button>
              )
            })}
          </div>
        </section>

        {activeProfile ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <p className="text-sm text-slate-400">Average publication</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatLatency(activeProfile.summaryMetrics.publicationMs)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <p className="text-sm text-slate-400">Hot derivative delivery</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatLatency(activeProfile.summaryMetrics.hotDeliveryMs)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <p className="text-sm text-slate-400">Cold derivative delivery</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatLatency(activeProfile.summaryMetrics.coldDeliveryMs)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <p className="text-sm text-slate-400">CDN edge hit rate</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatPercent(activeProfile.summaryMetrics.cdnEdgeHitRate)}
                </p>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
                <div className="mb-4 space-y-2">
                  <h2 className="text-2xl font-semibold text-white">Storage journey</h2>
                  <p className="text-sm leading-6 text-slate-300">
                    Pick an asset version and inspect how it leaves hot origin storage, lands in colder media, and
                    rehydrates on a cold read.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {activeProfile.objectStates.map((objectState) => {
                    const isActive = activeObjectState?.objectKey === objectState.objectKey

                    return (
                      <button
                        key={objectState.objectKey}
                        className={`rounded-full border px-4 py-2 text-sm transition ${
                          isActive
                            ? "border-sky-400/50 bg-sky-500/10 text-sky-100"
                            : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20"
                        }`}
                        onClick={() => setSelectedObjectKey(objectState.objectKey)}
                        type="button"
                      >
                        {objectState.title}
                      </button>
                    )
                  })}
                </div>

                {activeObjectState ? (
                  <>
                    <div className="mt-5 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-slate-400">Source export</p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {formatLatency(activeObjectState.metrics.sourceExportMs)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-slate-400">Cold restore</p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {formatLatency(activeObjectState.metrics.coldRestoreMs)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">
                      {activeObjectState.lifecycleTimeline.map((event) => (
                        <div key={`${activeObjectState.objectKey}-${event.offsetSeconds}-${event.label}`} className="flex gap-4">
                          <div className="flex w-20 shrink-0 items-start justify-end pt-1 text-xs font-medium text-sky-200">
                            +{formatSeconds(event.offsetSeconds)}
                          </div>
                          <div className="relative flex-1 rounded-2xl border border-white/10 bg-black/20 p-4">
                            <p className="text-sm font-medium text-white">{event.label}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                              {event.componentId} • {event.storageState}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
                <div className="mb-4 space-y-2">
                  <h2 className="text-2xl font-semibold text-white">Request-path explorer</h2>
                  <p className="text-sm leading-6 text-slate-300">
                    This is the architectural proof view: choose a request shape and see exactly which subsystem the
                    demo says gets hit, in order and with timing.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {[
                    { label: "Publication", traceType: "publication" },
                    { label: "Hot delivery", traceType: "hot-delivery" },
                    { label: "Cold delivery", traceType: "cold-delivery" },
                    { label: "Source export", traceType: "source-export" },
                  ].map((option) => {
                    const isActive = activeTrace?.traceType === option.traceType

                    return (
                      <button
                        key={option.traceType}
                        className={`rounded-full border px-4 py-2 text-sm transition ${
                          isActive
                            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                            : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20"
                        }`}
                        onClick={() => setSelectedTraceType(option.traceType)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>

                {activeTrace ? (
                  <>
                    <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-white">{activeTrace.title}</h3>
                          <p className="mt-2 text-sm leading-6 text-slate-300">{activeTrace.summary}</p>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
                          {activeTrace.cacheOutcome}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <p className="text-slate-400">Trace duration</p>
                          <p className="mt-1 text-xl font-semibold text-white">{formatLatency(activeTrace.totalMs)}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <p className="text-slate-400">Manifest lookup</p>
                          <p className="mt-1 text-xl font-semibold text-white">
                            {formatLatency(activeProfile.summaryMetrics.manifestMs)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <p className="text-slate-400">Hot-origin hit rate</p>
                          <p className="mt-1 text-xl font-semibold text-white">
                            {formatPercent(activeProfile.summaryMetrics.hotOriginHitRate)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      {architectureComponents.map((component) => {
                        const hit = architectureHits.get(component.componentId)

                        return (
                          <div
                            key={component.componentId}
                            className={`rounded-2xl border p-4 ${
                              hit
                                ? "border-sky-400/40 bg-sky-500/10"
                                : "border-white/10 bg-black/20 text-slate-400"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{component.layer}</p>
                                <h3 className="mt-1 text-base font-semibold text-white">{component.label}</h3>
                              </div>
                              {hit ? (
                                <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs font-medium text-sky-100">
                                  #{hit.order} • {formatLatency(hit.durationMs)}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-3 text-sm leading-6 text-slate-300">{component.responsibility}</p>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                      <table className="w-full text-left text-sm text-slate-200">
                        <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
                          <tr>
                            <th className="px-4 py-3">Offset</th>
                            <th className="px-4 py-3">Component</th>
                            <th className="px-4 py-3">Duration</th>
                            <th className="px-4 py-3">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeTrace.events.map((event) => (
                            <tr key={`${activeTrace.traceId}-${event.componentId}-${event.offsetMs}`} className="border-t border-white/10">
                              <td className="px-4 py-3 font-medium text-sky-100">{formatLatency(event.offsetMs)}</td>
                              <td className="px-4 py-3">{event.componentId}</td>
                              <td className="px-4 py-3">{formatLatency(event.durationMs)}</td>
                              <td className="px-4 py-3 text-slate-300">{event.action}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          </>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-sky-950/20">
          <div className="mb-4 space-y-2">
            <h2 className="text-2xl font-semibold text-white">API and SDK examples</h2>
            <p className="text-sm leading-6 text-slate-300">
              These snippets are generated from the current demo scenario, so the raw API flow and the SDK flow stay
              aligned with the contract and the current fluent CDNgine client surface.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { key: "api" as const, label: "Raw API" },
              { key: "sdk" as const, label: "TypeScript SDK" },
            ].map((option) => {
              const isActive = selectedExampleMode === option.key

              return (
                <button
                  key={option.key}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    isActive
                      ? "border-sky-400/50 bg-sky-500/10 text-sky-100"
                      : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20"
                  }`}
                  onClick={() => setSelectedExampleMode(option.key)}
                  type="button"
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5">
            <p className="text-sm font-medium text-white">{demoScenario.examples[selectedExampleMode].title}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {demoScenario.examples[selectedExampleMode].description}
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-4 text-xs leading-6 text-slate-200">
              <code>{demoScenario.examples[selectedExampleMode].code}</code>
            </pre>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-sky-950/20">
            <div className="mb-4 space-y-2">
              <h2 className="text-2xl font-semibold text-white">Interactive upload surface</h2>
              <p className="text-sm leading-6 text-slate-300">
                The upload board still uses the requested shadcn/ReUI component and is seeded with the generated
                scenario files for each tenant.
              </p>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              {tenants.map((tenant) => (
                <div key={tenant.tenantId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-4 space-y-1">
                    <h3 className="text-lg font-medium text-white">{tenant.tenantName}</h3>
                    <p className="text-xs uppercase tracking-[0.18em] text-sky-200">{tenant.tenantId}</p>
                  </div>
                  <Pattern
                    accept="image/*,application/pdf"
                    className="text-left"
                    initialFiles={buildInitialFiles(tenant.objects)}
                    maxFiles={8}
                    simulateUpload={false}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6">
                <h2 className="text-xl font-semibold text-white">Tenant isolation proof</h2>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                A caller authenticated for <span className="font-medium text-white">{demoScenario.crossTenantDenial.actorTenantId}</span>{" "}
                was denied when attempting to read <span className="font-medium text-white">{demoScenario.crossTenantDenial.targetTenantId}</span>{" "}
                content.
              </p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                <p>
                  <span className="font-medium text-white">Status:</span> {demoScenario.crossTenantDenial.status}
                </p>
                <p>
                  <span className="font-medium text-white">Problem type:</span> {demoScenario.crossTenantDenial.type}
                </p>
                <p className="mt-2 text-slate-300">{demoScenario.crossTenantDenial.detail}</p>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
              <h2 className="text-xl font-semibold text-white">Demo configuration</h2>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-medium text-white">Preview URL</p>
                  <p className="mt-1 text-xs text-slate-300">{demoScenario.environment.demoUrl}</p>
                  <p className="mt-3 text-sm font-medium text-white">API base URL</p>
                  <p className="mt-1 text-xs text-slate-300">{demoScenario.environment.apiBaseUrl}</p>
                  <p className="mt-3 text-xs text-slate-300">
                    Storage source: {demoScenario.environment.storage.configurationSource}
                    {demoScenario.environment.storage.autoCreatedBuckets ? " (auto-created demo buckets)" : ""}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-medium text-white">Storage buckets</p>
                  <div className="mt-3 grid gap-2 text-xs text-slate-300">
                    {Object.entries(demoScenario.environment.storage.buckets).map(([role, bucket]) => (
                      <p key={role}>
                        <span className="font-medium text-white">{role}:</span> {bucket}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
              <h2 className="text-xl font-semibold text-white">Authenticated actors</h2>
              <div className="mt-4 space-y-4">
                {demoScenario.tenants.map((tenant) => (
                  <div key={tenant.tenantId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-sm font-medium text-white">{tenant.tenantName}</p>
                    <p className="mt-1 text-xs text-slate-300">Bearer subject: {tenant.actorSubject}</p>
                    <p className="mt-1 text-xs text-slate-300">Principal email: {tenant.actorEmail}</p>
                    <p className="mt-1 text-xs text-slate-300">
                      Scoped roles: {tenant.roles.join(", ") || "none"}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Allowed namespaces: {tenant.allowedServiceNamespaces.join(", ") || "none"}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Allowed tenants: {tenant.allowedTenantIds.join(", ") || "none"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Bearer token preview: {tenant.tokenPreview}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-sky-950/20">
          <div className="mb-4 space-y-2">
            <h2 className="text-2xl font-semibold text-white">End-to-end object flow</h2>
            <p className="text-sm leading-6 text-slate-300">
              Upload sessions, immutable versions, workflow keys, manifests, and authorized downloads below all come
              from the generated scenario data.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {demoScenario.generatedObjects.map((item) => (
              <article key={`${item.assetId}-${item.versionId}`} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-sky-200">{item.tenantId}</p>
                    <h3 className="mt-2 text-lg font-semibold text-white">{item.title}</h3>
                    <p className="mt-1 text-sm text-slate-300">{item.source.filename}</p>
                  </div>
                  <div className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                    {item.lifecycleState}
                  </div>
                </div>

                <dl className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-400">Asset / version</dt>
                    <dd className="mt-1 font-medium text-white">
                      {item.assetId} / {item.versionId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Upload session</dt>
                    <dd className="mt-1 font-medium text-white">{item.uploadSessionId}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Workflow key</dt>
                    <dd className="mt-1 break-all text-xs text-slate-100">{item.workflowKey}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Manifest</dt>
                    <dd className="mt-1 font-medium text-white">{item.manifestType}</dd>
                  </div>
                </dl>

                <div className="mt-5 grid gap-3">
                  {item.downloads.map((download) => (
                    <div
                      key={`${item.assetId}-${download.kind}-${download.label}`}
                      className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{download.kind}</p>
                          <p className="mt-1 text-sm font-medium text-white">{download.label}</p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                          {download.resolvedOrigin}
                        </span>
                      </div>
                      <p className="mt-2 break-all text-xs text-slate-300">{download.url}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
