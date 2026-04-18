import { useEffect, useRef, useState } from 'react'

interface PipelineStep {
  detail: string
  step: string
}

interface UploadResult {
  assetId: string
  byteLength: number
  contentType: string
  downloadUrl: string
  filename: string
  steps: PipelineStep[]
  versionId: string
}

function formatBytes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`
  return `${n} B`
}

function DropZone({
  onFile,
  file
}: {
  onFile: (f: File) => void
  file: File | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div
      className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition ${
        dragOver
          ? 'border-sky-400 bg-sky-500/10'
          : 'border-white/20 bg-white/5 hover:border-white/30 hover:bg-white/10'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragLeave={() => setDragOver(false)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDrop={handleDrop}
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
          <div className="text-4xl">📄</div>
          <p className="text-base font-medium text-white">{file.name}</p>
          <p className="text-sm text-slate-400">{formatBytes(file.size)} · {file.type || 'unknown type'}</p>
          <p className="text-xs text-slate-500">Click or drop to replace</p>
        </>
      ) : (
        <>
          <div className="text-4xl">⬆</div>
          <p className="text-base font-medium text-white">Drop a file here or click to browse</p>
          <p className="text-sm text-slate-400">Any file type · runs through the CDNgine pipeline</p>
        </>
      )}
    </div>
  )
}

function StepCard({
  step,
  index,
  visible
}: {
  step: PipelineStep
  index: number
  visible: boolean
}) {
  return (
    <div
      className={`flex gap-4 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <div className="flex w-6 shrink-0 items-start justify-center">
        <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-300">
          {index + 1}
        </span>
      </div>
      <div className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <p className="text-sm font-semibold text-white">{step.step}</p>
        <p className="mt-0.5 font-mono text-xs text-slate-400 break-all">{step.detail}</p>
      </div>
    </div>
  )
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<UploadResult[]>([])

  useEffect(() => {
    if (!result) return
    setVisibleSteps(0)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setVisibleSteps(i)
      if (i >= result.steps.length) clearInterval(id)
    }, 350)
    return () => clearInterval(id)
  }, [result])

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setResult(null)
    setError(null)
    setVisibleSteps(0)

    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/_demo/upload', { body: form, method: 'POST' })
      const data = await res.json() as UploadResult & { error?: string }
      if (!res.ok) {
        throw new Error(data.error ?? `Upload failed (${res.status})`)
      }
      setResult(data)
      setHistory((prev) => [data, ...prev].slice(0, 10))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleNewUpload() {
    setFile(null)
    setResult(null)
    setError(null)
    setVisibleSteps(0)
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">

        {/* Header */}
        <div className="mb-10 space-y-3">
          <span className="inline-flex rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-sky-300">
            CDNgine · live demo
          </span>
          <h1 className="text-4xl font-semibold tracking-tight">
            Upload a file and watch the pipeline.
          </h1>
          <p className="max-w-xl text-slate-400">
            Drop any file below. CDNgine stages the bytes, canonicalizes the source, runs the
            publication workflow, and makes the file available for delivery — all in memory,
            right here.
          </p>
        </div>

        {/* Upload panel */}
        {!result && (
          <section className="space-y-4">
            <DropZone file={file} onFile={(f) => { setFile(f); setError(null) }} />

            {error && (
              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            <button
              className={`w-full rounded-xl px-6 py-4 text-base font-semibold transition ${
                file && !uploading
                  ? 'bg-sky-500 text-white hover:bg-sky-400 active:bg-sky-600'
                  : 'cursor-not-allowed bg-white/10 text-slate-500'
              }`}
              disabled={!file || uploading}
              onClick={handleUpload}
              type="button"
            >
              {uploading ? 'Uploading…' : 'Upload and run pipeline'}
            </button>
          </section>
        )}

        {/* Pipeline result */}
        {result && (
          <section className="space-y-6">
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-5 py-4">
              <p className="text-sm font-semibold text-emerald-300">Pipeline complete</p>
              <p className="mt-1 text-xs text-slate-300">
                <span className="font-medium text-white">{result.filename}</span>
                {' '}·{' '}
                {formatBytes(result.byteLength)}
                {' '}·{' '}
                {result.contentType}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                <p><span className="text-slate-500">Asset</span> <span className="ml-1 font-mono text-white">{result.assetId}</span></p>
                <p><span className="text-slate-500">Version</span> <span className="ml-1 font-mono text-white">{result.versionId}</span></p>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
                Pipeline steps
              </h2>
              <div className="space-y-2">
                {result.steps.map((step, i) => (
                  <StepCard
                    index={i}
                    key={step.step}
                    step={step}
                    visible={i < visibleSteps}
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            {visibleSteps >= result.steps.length && (
              <div className="flex flex-wrap gap-3">
                <a
                  className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 active:bg-sky-600"
                  download={result.filename}
                  href={result.downloadUrl}
                >
                  Download {result.filename}
                </a>
                <button
                  className="rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/40 hover:text-white"
                  onClick={handleNewUpload}
                  type="button"
                >
                  Upload another file
                </button>
              </div>
            )}
          </section>
        )}

        {/* Upload history */}
        {history.length > 0 && (
          <section className="mt-12 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
              Session history
            </h2>
            <div className="space-y-3">
              {history.map((item) => (
                <div
                  key={item.versionId}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{item.filename}</p>
                    <p className="font-mono text-xs text-slate-400">{item.versionId} · {formatBytes(item.byteLength)}</p>
                  </div>
                  <a
                    className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/40 hover:text-white"
                    download={item.filename}
                    href={item.downloadUrl}
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

export default App
