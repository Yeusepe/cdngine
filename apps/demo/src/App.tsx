import { useRef, useState } from 'react'

import { type ProdUploadFlowResult, uploadFileThroughProdApi } from './prod-upload-flow.ts'

interface PipelineNodeDef {
  activeClass: string
  description: string
  dotClass: string
  id: string
  label: string
  ringClass: string
}

const PIPELINE_NODES: PipelineNodeDef[] = [
  {
    activeClass: 'border-sky-400/40 bg-sky-500/15 shadow-lg shadow-sky-950/20',
    description: 'Validates caller scope, issues the upload session, and assigns asset and version ids.',
    dotClass: 'bg-sky-400',
    id: 'api-edge',
    label: 'API Edge',
    ringClass: 'ring-4 ring-sky-400/40'
  },
  {
    activeClass: 'border-violet-400/40 bg-violet-500/15 shadow-lg shadow-violet-950/20',
    description: 'Receives the raw bytes through the TUS PATCH upload target and holds them in staging.',
    dotClass: 'bg-violet-400',
    id: 'ingest-staging',
    label: 'Staging Store',
    ringClass: 'ring-4 ring-violet-400/40'
  },
  {
    activeClass: 'border-amber-400/40 bg-amber-500/15 shadow-lg shadow-amber-950/20',
    description: 'Snapshots the canonical source and records immutable source evidence.',
    dotClass: 'bg-amber-400',
    id: 'canonical-source',
    label: 'Canonical Source',
    ringClass: 'ring-4 ring-amber-400/40'
  },
  {
    activeClass: 'border-emerald-400/40 bg-emerald-500/15 shadow-lg shadow-emerald-950/20',
    description: 'Records workflow dispatch and hands the version off to the publish pipeline.',
    dotClass: 'bg-emerald-400',
    id: 'workflow-controller',
    label: 'Workflow Controller',
    ringClass: 'ring-4 ring-emerald-400/40'
  },
  {
    activeClass: 'border-orange-400/40 bg-orange-500/15 shadow-lg shadow-orange-950/20',
    description: 'Builds delivery derivatives when workers advance the version beyond canonical.',
    dotClass: 'bg-orange-400',
    id: 'derivation-worker',
    label: 'Derivation Worker',
    ringClass: 'ring-4 ring-orange-400/40'
  },
  {
    activeClass: 'border-rose-400/40 bg-rose-500/15 shadow-lg shadow-rose-950/20',
    description: 'Publishes manifests and delivery bindings once the version is ready for delivery.',
    dotClass: 'bg-rose-400',
    id: 'delivery-registry',
    label: 'Delivery Registry',
    ringClass: 'ring-4 ring-rose-400/40'
  }
]

const FALLBACK_NODE = PIPELINE_NODES[0] as PipelineNodeDef

interface PipelineStep {
  component: string
  detail: string
  step: string
}

interface UploadRecord {
  assetId: string
  byteLength: number
  contentType: string
  filename: string
  lifecycleState: string
  objectKey: string
  steps: PipelineStep[]
  uploadSessionId: string
  versionId: string
  versionPath: string
  workflowDispatchState: string
  workflowKey: string
  workflowState: string
}

function formatBytes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`
  return `${n} B`
}

function findNode(id: string): PipelineNodeDef {
  return PIPELINE_NODES.find((node) => node.id === id) ?? FALLBACK_NODE
}

function getVersionPath(assetId: string, versionId: string) {
  return `/v1/assets/${assetId}/versions/${versionId}`
}

function buildPipelineSteps(result: ProdUploadFlowResult): PipelineStep[] {
  const canonicalStep =
    result.version.lifecycleState === 'canonicalizing'
      ? {
          component: 'canonical-source',
          detail: `Completion returned versionState ${result.completion.versionState}`,
          step: 'Canonical source is still being prepared'
        }
      : {
          component: 'canonical-source',
          detail: `Completion returned versionState ${result.completion.versionState}`,
          step: 'Canonical source captured'
        }
  const steps: PipelineStep[] = [
    {
      component: 'api-edge',
      detail: `Session ${result.uploadSessionId} | Asset ${result.assetId} | Version ${result.versionId}`,
      step: 'Upload session issued'
    },
    {
      component: 'ingest-staging',
      detail: `Target ${result.session.uploadTarget.protocol.toUpperCase()} ${result.session.uploadTarget.method} | Object ${result.objectKey}`,
      step: 'Bytes written to staging'
    },
    canonicalStep,
    {
      component: 'workflow-controller',
      detail: `${result.completion.workflowDispatch.workflowKey} | dispatch ${result.completion.workflowDispatch.state}`,
      step: 'Publish workflow dispatched'
    }
  ]

  if (result.version.lifecycleState === 'processing' || result.version.lifecycleState === 'published') {
    steps.push({
      component: 'derivation-worker',
      detail: `Workflow state ${result.version.workflowState}`,
      step: 'Worker pipeline running'
    })
  }

  if (result.version.lifecycleState === 'published') {
    steps.push({
      component: 'delivery-registry',
      detail: `Version lifecycle ${result.version.lifecycleState}`,
      step: 'Delivery registry published'
    })
  }

  return steps
}

function buildUploadRecord(result: ProdUploadFlowResult): UploadRecord {
  return {
    assetId: result.assetId,
    byteLength: result.version.source.byteLength,
    contentType: result.version.source.contentType,
    filename: result.version.source.filename,
    lifecycleState: result.version.lifecycleState,
    objectKey: result.objectKey,
    steps: buildPipelineSteps(result),
    uploadSessionId: result.uploadSessionId,
    versionId: result.versionId,
    versionPath: getVersionPath(result.assetId, result.versionId),
    workflowDispatchState: result.completion.workflowDispatch.state,
    workflowKey: result.completion.workflowDispatch.workflowKey,
    workflowState: result.version.workflowState
  }
}

function getLifecycleTone(record: UploadRecord | null) {
  switch (record?.lifecycleState) {
    case 'canonicalizing':
      return {
        badgeClass: 'border-violet-400/30 bg-violet-500/10 text-violet-300',
        label: 'Canonicalization in progress',
        description: 'The upload is committed and the service is still verifying and snapshotting the canonical source.'
      }
    case 'published':
      return {
        badgeClass: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
        label: 'Ready for delivery',
        description: 'Workers published delivery outputs and the public read surface can now serve them.'
      }
    case 'processing':
      return {
        badgeClass: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
        label: 'Processing in progress',
        description: 'Canonical source capture is complete and workers are still building delivery outputs.'
      }
    case 'quarantined':
      return {
        badgeClass: 'border-rose-400/30 bg-rose-500/10 text-rose-300',
        label: 'Quarantined',
        description: 'The version is quarantined and delivery is intentionally blocked.'
      }
    case 'failed_retryable':
      return {
        badgeClass: 'border-rose-400/30 bg-rose-500/10 text-rose-300',
        label: 'Retry required',
        description: 'The workflow hit a retryable failure. The version is not ready for delivery yet.'
      }
    case 'canonical':
    default:
      return {
        badgeClass: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
        label: 'Canonical source captured',
        description: 'The upload completed through the production contract and queued the publish workflow. Delivery outputs are not published yet.'
      }
  }
}

function PipelineNode({
  active,
  node,
  touched
}: {
  active: boolean
  node: PipelineNodeDef
  touched: boolean
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border p-4 transition-all duration-500 ${
        active ? node.activeClass : touched ? 'border-white/20 bg-white/5' : 'border-white/10 bg-black/20'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full transition-all duration-300 ${
            active
              ? `${node.dotClass} ${node.ringClass} animate-pulse`
              : touched
                ? `${node.dotClass} opacity-50`
                : 'bg-white/20'
          }`}
        />
        <p
          className={`text-xs font-semibold uppercase tracking-wider ${
            active ? 'text-white' : touched ? 'text-slate-300' : 'text-slate-500'
          }`}
        >
          {node.label}
        </p>
      </div>
      <p className={`text-xs leading-5 ${active ? 'text-slate-200' : 'text-slate-500'}`}>
        {node.description}
      </p>
    </div>
  )
}

function StepRow({ index, step }: { index: number; step: PipelineStep }) {
  const node = findNode(step.component)

  return (
    <div className="flex animate-[fadeSlideIn_0.3s_ease_both] gap-3">
      <div className="flex w-6 shrink-0 flex-col items-center">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${node.dotClass}`}>
          {index + 1}
        </span>
        <div className="mt-1 flex-1 border-l border-white/10" />
      </div>
      <div className="mb-3 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white">{step.step}</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white ${node.dotClass}`}>
            {node.label}
          </span>
        </div>
        <p className="mt-1 break-all font-mono text-xs text-slate-400">{step.detail}</p>
      </div>
    </div>
  )
}

function DropZone({ file, onFile }: { file: File | null; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
        dragOver ? 'border-sky-400 bg-sky-500/10' : 'border-white/20 bg-white/5 hover:border-white/30'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragLeave={() => setDragOver(false)}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        const droppedFile = event.dataTransfer.files[0]
        if (droppedFile) {
          onFile(droppedFile)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        className="hidden"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0]
          if (selectedFile) {
            onFile(selectedFile)
          }
        }}
        type="file"
      />
      {file ? (
        <>
          <div>
            <p className="font-semibold text-white">{file.name}</p>
            <p className="mt-1 text-sm text-slate-400">
              {formatBytes(file.size)} | {file.type || 'application/octet-stream'}
            </p>
          </div>
          <p className="text-xs text-slate-500">Click or drop to replace</p>
        </>
      ) : (
        <>
          <div>
            <p className="font-semibold text-white">Drop a file here, or click to browse</p>
            <p className="mt-1 text-sm text-slate-400">
              Uploads are issued as public upload sessions, streamed to the returned TUS target,
              then read back through the version resource.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>([])
  const [activeNode, setActiveNode] = useState<string | null>(null)
  const [touchedNodes, setTouchedNodes] = useState<Set<string>>(new Set())
  const [complete, setComplete] = useState<UploadRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<UploadRecord[]>([])
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  async function handleUpload() {
    if (!file || running) return

    setRunning(true)
    setSteps([])
    setActiveNode('api-edge')
    setTouchedNodes(new Set(['api-edge']))
    setComplete(null)
    setError(null)
    setUploadProgress(0)

    try {
      const result = await uploadFileThroughProdApi({
        assetOwner: 'product:web-client',
        baseUrl: window.location.origin,
        file,
        filename: file.name,
        onUploadProgress: (progress) => {
          setUploadProgress(progress)
          setActiveNode('ingest-staging')
          setTouchedNodes(new Set(['api-edge', 'ingest-staging']))
        },
        serviceNamespaceId: 'media-platform'
      })
      const record = buildUploadRecord(result)
      const touched = new Set(record.steps.map((step) => step.component))

      setSteps(record.steps)
      setTouchedNodes(touched)
      setActiveNode(null)
      setComplete(record)
      setHistory((previous) => [record, ...previous].slice(0, 8))
    } catch (uploadError) {
      setActiveNode(null)
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.')
    } finally {
      setRunning(false)
      setUploadProgress(null)
    }
  }

  function handleReset() {
    setFile(null)
    setSteps([])
    setActiveNode(null)
    setTouchedNodes(new Set())
    setComplete(null)
    setError(null)
    setRunning(false)
    setUploadProgress(null)
  }

  const showUpload = !running && steps.length === 0 && !complete
  const tone = getLifecycleTone(complete)

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10">
          <span className="inline-flex rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-sky-300">
            CDNgine | product upload client
          </span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            Upload through the public API and inspect the real version lifecycle.
          </h1>
          <p className="mt-3 max-w-3xl text-slate-400">
            This client follows the public upload contract end to end: create an upload session,
            PATCH the returned TUS target, complete the session, and read the version resource so
            the UI reflects whether the asset is canonicalizing, canonical, processing, published,
            or quarantined.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE_NODES.map((node) => (
            <PipelineNode
              active={activeNode === node.id}
              key={node.id}
              node={node}
              touched={touchedNodes.has(node.id)}
            />
          ))}
        </div>

        {showUpload && (
          <div className="space-y-4">
            <DropZone file={file} onFile={(selectedFile) => {
              setFile(selectedFile)
              setError(null)
            }} />
            {error && (
              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}
            <button
              className={`w-full rounded-xl px-6 py-4 text-base font-semibold transition ${
                file
                  ? 'bg-sky-500 text-white hover:bg-sky-400 active:bg-sky-600'
                  : 'cursor-not-allowed bg-white/10 text-slate-500'
              }`}
              disabled={!file}
              onClick={handleUpload}
              type="button"
            >
              Upload through public API
            </button>
          </div>
        )}

        {(running || steps.length > 0) && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {running
                      ? uploadProgress !== null && uploadProgress < 100
                        ? `Uploading staged bytes: ${uploadProgress}%`
                        : 'Completing upload session and reading version state...'
                      : 'Upload flow completed'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    The page is exercising the same public API contract a shipped product client should use.
                  </p>
                </div>
                {running && (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400" />
                )}
              </div>
              {running && (
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-sky-400 transition-all"
                    style={{ width: `${uploadProgress ?? 5}%` }}
                  />
                </div>
              )}
            </div>

            {steps.length > 0 && (
              <div>
                {steps.map((step, index) => (
                  <StepRow index={index} key={`${step.step}-${index}`} step={step} />
                ))}
              </div>
            )}

            {complete && (
              <div className={`animate-[fadeSlideIn_0.4s_ease_both] rounded-2xl border p-5 ${tone.badgeClass}`}>
                <p className="text-sm font-semibold">{tone.label}</p>
                <p className="mt-2 text-sm text-slate-200">{tone.description}</p>
                <div className="mt-4 grid gap-2 text-xs text-slate-200 sm:grid-cols-2">
                  <p>
                    <span className="text-slate-400">File</span>
                    <span className="ml-2 font-medium text-white">{complete.filename}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Size</span>
                    <span className="ml-2 font-medium text-white">{formatBytes(complete.byteLength)}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Asset</span>
                    <span className="ml-2 font-mono text-white">{complete.assetId}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Version</span>
                    <span className="ml-2 font-mono text-white">{complete.versionId}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Lifecycle</span>
                    <span className="ml-2 font-medium text-white">{complete.lifecycleState}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Workflow</span>
                    <span className="ml-2 font-medium text-white">
                      {complete.workflowState} | dispatch {complete.workflowDispatchState}
                    </span>
                  </p>
                  <p className="sm:col-span-2">
                    <span className="text-slate-400">Workflow key</span>
                    <span className="ml-2 break-all font-mono text-white">{complete.workflowKey}</span>
                  </p>
                  <p className="sm:col-span-2">
                    <span className="text-slate-400">Object key</span>
                    <span className="ml-2 break-all font-mono text-white">{complete.objectKey}</span>
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400"
                    href={complete.versionPath}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View version JSON
                  </a>
                  <button
                    className="rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-white/40 hover:text-white"
                    onClick={handleReset}
                    type="button"
                  >
                    Upload another file
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-12 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Session history
            </h2>
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.versionId}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{item.filename}</p>
                    <p className="font-mono text-xs text-slate-400">
                      {item.versionId} | {item.lifecycleState} | {formatBytes(item.byteLength)}
                    </p>
                  </div>
                  <a
                    className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/40"
                    href={item.versionPath}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View state
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default App
