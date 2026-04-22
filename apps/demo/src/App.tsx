import { useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Architecture pipeline nodes
// ---------------------------------------------------------------------------

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
    description: 'Validates caller, issues the upload session, assigns asset and version IDs.',
    dotClass: 'bg-sky-400',
    id: 'api-edge',
    label: 'API Edge',
    ringClass: 'ring-4 ring-sky-400/40'
  },
  {
    activeClass: 'border-violet-400/40 bg-violet-500/15 shadow-lg shadow-violet-950/20',
    description: 'Receives the raw bytes and holds them in staging until canonicalization.',
    dotClass: 'bg-violet-400',
    id: 'ingest-staging',
    label: 'Staging Store',
    ringClass: 'ring-4 ring-violet-400/40'
  },
  {
    activeClass: 'border-amber-400/40 bg-amber-500/15 shadow-lg shadow-amber-950/20',
    description: 'Snapshots an immutable copy of the source — the permanent truth of record.',
    dotClass: 'bg-amber-400',
    id: 'canonical-source',
    label: 'Canonical Source',
    ringClass: 'ring-4 ring-amber-400/40'
  },
  {
    activeClass: 'border-emerald-400/40 bg-emerald-500/15 shadow-lg shadow-emerald-950/20',
    description: 'Starts the publication workflow and hands off to the processing task queue.',
    dotClass: 'bg-emerald-400',
    id: 'workflow-controller',
    label: 'Workflow Controller',
    ringClass: 'ring-4 ring-emerald-400/40'
  },
  {
    activeClass: 'border-orange-400/40 bg-orange-500/15 shadow-lg shadow-orange-950/20',
    description: 'Runs derivation recipes, writes outputs to the derived object store.',
    dotClass: 'bg-orange-400',
    id: 'derivation-worker',
    label: 'Derivation Worker',
    ringClass: 'ring-4 ring-orange-400/40'
  },
  {
    activeClass: 'border-rose-400/40 bg-rose-500/15 shadow-lg shadow-rose-950/20',
    description: 'Records manifests, delivery bindings, and sets lifecycle state to published.',
    dotClass: 'bg-rose-400',
    id: 'delivery-registry',
    label: 'Delivery Registry',
    ringClass: 'ring-4 ring-rose-400/40'
  }
]

const FALLBACK_NODE = PIPELINE_NODES[0] as PipelineNodeDef

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineStep {
  component: string
  detail: string
  step: string
}

interface UploadComplete {
  assetId: string
  byteLength: number
  contentType: string
  downloadUrl: string
  filename: string
  versionId: string
}

interface HistoryEntry extends UploadComplete {
  steps: PipelineStep[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`
  return `${n} B`
}

function findNode(id: string): PipelineNodeDef {
  return PIPELINE_NODES.find((n) => n.id === id) ?? FALLBACK_NODE
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PipelineNode({
  node,
  active,
  touched
}: {
  node: PipelineNodeDef
  active: boolean
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
        <p className={`text-xs font-semibold uppercase tracking-wider ${
          active ? 'text-white' : touched ? 'text-slate-300' : 'text-slate-500'
        }`}>
          {node.label}
        </p>
      </div>
      <p className={`text-xs leading-5 ${active ? 'text-slate-200' : 'text-slate-500'}`}>
        {node.description}
      </p>
    </div>
  )
}

function StepRow({ step, index }: { step: PipelineStep; index: number }) {
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

function DropZone({ onFile, file }: { onFile: (f: File) => void; file: File | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
        dragOver ? 'border-sky-400 bg-sky-500/10' : 'border-white/20 bg-white/5 hover:border-white/30'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragLeave={() => setDragOver(false)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
        type="file"
      />
      {file ? (
        <>
          <p className="text-3xl">📄</p>
          <div>
            <p className="font-semibold text-white">{file.name}</p>
            <p className="mt-1 text-sm text-slate-400">{formatBytes(file.size)} · {file.type || 'unknown type'}</p>
          </div>
          <p className="text-xs text-slate-500">Click or drop to replace</p>
        </>
      ) : (
        <>
          <p className="text-4xl opacity-40">↑</p>
          <div>
            <p className="font-semibold text-white">Drop a file here, or click to browse</p>
            <p className="mt-1 text-sm text-slate-400">Any file type — watch it move through the CDNgine pipeline</p>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>([])
  const [activeNode, setActiveNode] = useState<string | null>(null)
  const [touchedNodes, setTouchedNodes] = useState<Set<string>>(new Set())
  const [complete, setComplete] = useState<UploadComplete | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  async function handleUpload() {
    if (!file || running) return

    setRunning(true)
    setSteps([])
    setActiveNode(null)
    setTouchedNodes(new Set())
    setComplete(null)
    setError(null)

    const form = new FormData()
    form.append('file', file)

    let response: Response
    try {
      response = await fetch('/_demo/upload', { body: form, method: 'POST' })
    } catch {
      setError('Could not reach the demo API server. Is it running on port 4000?')
      setRunning(false)
      return
    }

    if (!response.body) {
      setError(`Upload failed (${response.status})`)
      setRunning(false)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const collectedSteps: PipelineStep[] = []

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          let event: Record<string, unknown>
          try {
            event = JSON.parse(line.slice(6)) as Record<string, unknown>
          } catch {
            continue
          }

          if (event['type'] === 'step') {
            const step = event as unknown as PipelineStep
            collectedSteps.push(step)
            setSteps((prev) => [...prev, step])
            setActiveNode(step.component)
            setTouchedNodes((prev) => new Set([...prev, step.component]))
          } else if (event['type'] === 'complete') {
            const result = event as unknown as UploadComplete
            setComplete(result)
            setActiveNode(null)
            setHistory((prev) => [{ ...result, steps: collectedSteps }, ...prev].slice(0, 8))
          } else if (event['type'] === 'error') {
            setError(String(event['error'] ?? 'Pipeline error'))
          }
        }
      }
    } catch {
      setError('Stream interrupted — check that the demo API server is running.')
    } finally {
      setRunning(false)
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
  }

  const showUpload = !running && steps.length === 0 && !complete

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="mx-auto max-w-5xl px-6 py-12">

        {/* Header */}
        <div className="mb-10">
          <span className="inline-flex rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-sky-300">
            CDNgine · live pipeline demo
          </span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            Upload a file. Watch every system it touches.
          </h1>
          <p className="mt-3 max-w-2xl text-slate-400">
            Drop any file below. CDNgine stages the bytes, canonicalizes the source, dispatches
            a publication workflow, processes derivatives, and registers the manifest — each step
            streamed live.
          </p>
        </div>

        {/* Pipeline architecture diagram */}
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

        {/* Upload panel */}
        {showUpload && (
          <div className="space-y-4">
            <DropZone file={file} onFile={(f) => { setFile(f); setError(null) }} />
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
              Upload and run pipeline
            </button>
          </div>
        )}

        {/* Live pipeline output */}
        {(running || steps.length > 0) && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              {running ? (
                <>
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400" />
                  <p className="text-sm font-medium text-slate-300">Pipeline running…</p>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <p className="text-sm font-medium text-slate-300">Pipeline complete</p>
                </>
              )}
            </div>

            <div>
              {steps.map((step, i) => (
                <StepRow index={i} key={`${step.step}-${i}`} step={step} />
              ))}
            </div>

            {complete && (
              <div className="animate-[fadeSlideIn_0.4s_ease_both] rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5">
                <p className="text-sm font-semibold text-emerald-300">Ready for delivery</p>
                <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                  <p>
                    <span className="text-slate-500">File</span>
                    <span className="ml-2 font-medium text-white">{complete.filename}</span>
                  </p>
                  <p>
                    <span className="text-slate-500">Size</span>
                    <span className="ml-2 font-medium text-white">{formatBytes(complete.byteLength)}</span>
                  </p>
                  <p>
                    <span className="text-slate-500">Asset</span>
                    <span className="ml-2 font-mono text-white">{complete.assetId}</span>
                  </p>
                  <p>
                    <span className="text-slate-500">Version</span>
                    <span className="ml-2 font-mono text-white">{complete.versionId}</span>
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400"
                    download={complete.filename}
                    href={complete.downloadUrl}
                  >
                    Download {complete.filename}
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

        {/* Session history */}
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
                      {item.versionId} · {formatBytes(item.byteLength)} · {item.steps.length} steps
                    </p>
                  </div>
                  <a
                    className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/40"
                    download={item.filename}
                    href={item.downloadUrl}
                  >
                    Download
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
