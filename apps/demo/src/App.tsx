/**
 * Purpose: Renders the public CDNgine product client so authenticated users can upload through the real public contract and inspect version, manifest, source, and delivery reads from one surface.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/public-api-and-sdk-tutorial.md
 * - docs/testing-strategy.md
 * External references:
 * - https://react.dev/
 * - https://developer.mozilla.org/en-US/docs/Web/API/File
 * Tests:
 * - apps/demo/test/prod-upload-flow.test.ts
 * - apps/demo/test/product-client-surface.test.mjs
 * - apps/demo/test/public-surface-helpers.test.ts
 */

import { useRef, useState } from 'react'

import { createCDNgineClient } from '@cdngine/sdk'

import { type ProdUploadFlowResult, uploadFileThroughProdApi } from './prod-upload-flow.ts'
import {
  formatJson,
  normalizeOptionalText,
  suggestContractExplorerDefaults
} from './public-surface-helpers.ts'

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

interface UploadScopeForm {
  assetOwner: string
  serviceNamespaceId: string
  tenantId: string
}

interface VersionExplorerForm {
  assetId: string
  deliveryScopeId: string
  manifestType: string
  preferredDisposition: 'attachment' | 'inline'
  variant: string
  versionId: string
}

interface ExplorerResults {
  deliveryAuthorization?: unknown
  derivatives?: unknown
  manifest?: unknown
  sourceAuthorization?: unknown
  version?: unknown
}

type ExplorerAction =
  | 'authorize-delivery'
  | 'authorize-source'
  | 'load-manifest'
  | 'load-version'
  | 'list-derivatives'

const DEFAULT_SCOPE_FORM: UploadScopeForm = {
  assetOwner: '',
  serviceNamespaceId: '',
  tenantId: ''
}

const DEFAULT_EXPLORER_FORM: VersionExplorerForm = {
  assetId: '',
  deliveryScopeId: '',
  manifestType: '',
  preferredDisposition: 'attachment',
  variant: '',
  versionId: ''
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
        description:
          'The upload is committed and the service is still verifying and snapshotting the canonical source.'
      }
    case 'published':
      return {
        badgeClass: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
        label: 'Ready for delivery',
        description:
          'Workers published delivery outputs and the public read surface can now serve them.'
      }
    case 'processing':
      return {
        badgeClass: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
        label: 'Processing in progress',
        description:
          'Canonical source capture is complete and workers are still building delivery outputs.'
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
        description:
          'The workflow hit a retryable failure. The version is not ready for delivery yet.'
      }
    case 'canonical':
    default:
      return {
        badgeClass: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
        label: 'Canonical source captured',
        description:
          'The upload completed through the public contract and queued the publish workflow. Delivery outputs are not published yet.'
      }
  }
}

function getExplorerActionLabel(action: ExplorerAction, runningAction: ExplorerAction | null) {
  if (runningAction !== action) {
    switch (action) {
      case 'load-version':
        return 'Load version'
      case 'list-derivatives':
        return 'List derivatives'
      case 'load-manifest':
        return 'Load manifest'
      case 'authorize-source':
        return 'Authorize source'
      case 'authorize-delivery':
        return 'Authorize delivery'
    }
  }

  switch (action) {
    case 'load-version':
      return 'Loading version...'
    case 'list-derivatives':
      return 'Loading derivatives...'
    case 'load-manifest':
      return 'Loading manifest...'
    case 'authorize-source':
      return 'Authorizing source...'
    case 'authorize-delivery':
      return 'Authorizing delivery...'
  }
}

function createBrowserClient() {
  return createCDNgineClient({
    baseUrl: window.location.origin
  })
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

function TextField({
  label,
  onChange,
  placeholder,
  required = false,
  value
}: {
  label: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  value: string
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-')

  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <input
        className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/70"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type="text"
        value={value}
      />
    </label>
  )
}

function ResourceCard({
  payload,
  title
}: {
  payload: unknown
  title: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-slate-400">
          Public contract
        </span>
      </div>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-white/5 bg-slate-950/80 p-4 text-xs leading-6 text-slate-300">
        {formatJson(payload)}
      </pre>
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
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
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
        <div>
          <p className="font-semibold text-white">Drop a file here, or click to browse</p>
          <p className="mt-1 text-sm text-slate-400">
            The browser issues a public upload session, PATCHes the returned TUS target,
            completes the upload, then re-reads the version resource.
          </p>
        </div>
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
  const [scopeForm, setScopeForm] = useState<UploadScopeForm>(DEFAULT_SCOPE_FORM)
  const [explorerForm, setExplorerForm] = useState<VersionExplorerForm>(DEFAULT_EXPLORER_FORM)
  const [explorerBusy, setExplorerBusy] = useState<ExplorerAction | null>(null)
  const [explorerError, setExplorerError] = useState<string | null>(null)
  const [explorerResults, setExplorerResults] = useState<ExplorerResults>({})

  async function handleUpload() {
    if (!file || running) return

    const serviceNamespaceId = scopeForm.serviceNamespaceId.trim()
    const assetOwner = scopeForm.assetOwner.trim()

    if (!serviceNamespaceId || !assetOwner) {
      setError('Service namespace and asset owner are required before starting an upload.')
      return
    }

    setRunning(true)
    setSteps([])
    setActiveNode('api-edge')
    setTouchedNodes(new Set(['api-edge']))
    setComplete(null)
    setError(null)
    setUploadProgress(0)

    try {
      const tenantId = normalizeOptionalText(scopeForm.tenantId)
      const result = await uploadFileThroughProdApi({
        assetOwner,
        baseUrl: window.location.origin,
        file,
        filename: file.name,
        onUploadProgress: (progress) => {
          setUploadProgress(progress)
          setActiveNode('ingest-staging')
          setTouchedNodes(new Set(['api-edge', 'ingest-staging']))
        },
        serviceNamespaceId,
        ...(tenantId ? { tenantId } : {})
      })
      const record = buildUploadRecord(result)
      const touched = new Set(record.steps.map((step) => step.component))
      const defaults = suggestContractExplorerDefaults(result.version.source.contentType)

      setSteps(record.steps)
      setTouchedNodes(touched)
      setActiveNode(null)
      setComplete(record)
      setHistory((previous) => [record, ...previous].slice(0, 8))
      setExplorerForm((previous) => ({
        ...previous,
        assetId: result.assetId,
        deliveryScopeId: defaults.deliveryScopeId,
        manifestType: defaults.manifestType,
        variant: defaults.variant,
        versionId: result.versionId
      }))
      setExplorerResults({
        version: result.version
      })
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

  async function runExplorerAction(action: ExplorerAction) {
    const assetId = explorerForm.assetId.trim()
    const versionId = explorerForm.versionId.trim()

    if (!assetId || !versionId) {
      setExplorerError('Asset ID and version ID are required before using the version explorer.')
      return
    }

    setExplorerBusy(action)
    setExplorerError(null)

    try {
      const client = createBrowserClient()
      const versionClient = client.asset(assetId).version(versionId)

      if (action === 'load-version') {
        const version = await versionClient.get()
        setExplorerResults((previous) => ({ ...previous, version }))
      }

      if (action === 'list-derivatives') {
        const derivatives = await versionClient.listDerivatives()
        setExplorerResults((previous) => ({ ...previous, derivatives }))
      }

      if (action === 'load-manifest') {
        const manifestType = explorerForm.manifestType.trim()
        if (!manifestType) {
          throw new Error('A manifest type is required before loading a manifest.')
        }
        const manifest = await versionClient.manifest(manifestType).get()
        setExplorerResults((previous) => ({ ...previous, manifest }))
      }

      if (action === 'authorize-source') {
        const sourceAuthorization = await versionClient.source().authorize({
          body: {
            preferredDisposition: explorerForm.preferredDisposition
          },
          idempotencyKey: `source-${assetId}-${versionId}-${explorerForm.preferredDisposition}`
        })
        setExplorerResults((previous) => ({ ...previous, sourceAuthorization }))
      }

      if (action === 'authorize-delivery') {
        const deliveryScopeId = explorerForm.deliveryScopeId.trim()
        const variant = explorerForm.variant.trim()

        if (!deliveryScopeId || !variant) {
          throw new Error('Delivery scope and variant are required before requesting delivery authorization.')
        }

        const deliveryAuthorization = await versionClient.delivery(deliveryScopeId).authorize({
          body: {
            responseFormat: 'url',
            variant
          },
          idempotencyKey: `delivery-${assetId}-${versionId}-${deliveryScopeId}-${variant}`
        })
        setExplorerResults((previous) => ({ ...previous, deliveryAuthorization }))
      }
    } catch (actionError) {
      setExplorerError(actionError instanceof Error ? actionError.message : 'The requested public contract call failed.')
    } finally {
      setExplorerBusy(null)
    }
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

      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10">
          <span className="inline-flex rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-sky-300">
            CDNgine | product upload client
          </span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            Upload through the public API and inspect the real version lifecycle.
          </h1>
          <p className="mt-3 max-w-4xl text-slate-400">
            This client stays on the product contract. It issues public upload sessions, PATCHes the returned
            TUS target, completes the session, then exposes the same version, manifest, source, and delivery
            reads a shipped product client would call in production.
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

        <div className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-white">Upload scope</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Enter the same namespace, asset owner, and optional tenant your product would send on the real
                  public upload contract.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label="Service namespace"
                  onChange={(value) =>
                    setScopeForm((previous) => ({ ...previous, serviceNamespaceId: value }))
                  }
                  placeholder="media-platform"
                  required
                  value={scopeForm.serviceNamespaceId}
                />
                <TextField
                  label="Asset owner"
                  onChange={(value) =>
                    setScopeForm((previous) => ({ ...previous, assetOwner: value }))
                  }
                  placeholder="customer:acme"
                  required
                  value={scopeForm.assetOwner}
                />
                <TextField
                  label="Tenant ID"
                  onChange={(value) =>
                    setScopeForm((previous) => ({ ...previous, tenantId: value }))
                  }
                  placeholder="tenant-acme"
                  value={scopeForm.tenantId}
                />
              </div>
            </div>

            {showUpload && (
              <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-6">
                <DropZone
                  file={file}
                  onFile={(selectedFile) => {
                    setFile(selectedFile)
                    setError(null)
                  }}
                />
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
                  disabled={!file || running}
                  onClick={handleUpload}
                  type="button"
                >
                  {running ? 'Uploading through public API...' : 'Upload through public API'}
                </button>
              </div>
            )}

            {(running || steps.length > 0) && (
              <div className="space-y-6 rounded-2xl border border-white/10 bg-black/20 p-6">
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
                      The client is exercising the shipped public route and SDK contract, not a demo-only transport.
                    </p>
                  </div>
                  {running && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400" />}
                </div>
                {running && (
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-sky-400 transition-all"
                      style={{ width: `${uploadProgress ?? 5}%` }}
                    />
                  </div>
                )}

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
              <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-6">
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
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-white">Version explorer</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Inspect the public read surface for any known asset version. The buttons below call the same
                  SDK methods a production product client would use after upload, publish, or replay.
                </p>
              </div>
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label="Asset ID"
                    onChange={(value) =>
                      setExplorerForm((previous) => ({ ...previous, assetId: value }))
                    }
                    placeholder="ast_001"
                    required
                    value={explorerForm.assetId}
                  />
                  <TextField
                    label="Version ID"
                    onChange={(value) =>
                      setExplorerForm((previous) => ({ ...previous, versionId: value }))
                    }
                    placeholder="ver_001"
                    required
                    value={explorerForm.versionId}
                  />
                  <TextField
                    label="Delivery scope"
                    onChange={(value) =>
                      setExplorerForm((previous) => ({ ...previous, deliveryScopeId: value }))
                    }
                    placeholder="public-images"
                    value={explorerForm.deliveryScopeId}
                  />
                  <TextField
                    label="Variant"
                    onChange={(value) =>
                      setExplorerForm((previous) => ({ ...previous, variant: value }))
                    }
                    placeholder="webp-master"
                    value={explorerForm.variant}
                  />
                  <TextField
                    label="Manifest type"
                    onChange={(value) =>
                      setExplorerForm((previous) => ({ ...previous, manifestType: value }))
                    }
                    placeholder="image-default"
                    value={explorerForm.manifestType}
                  />
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Source disposition
                    </span>
                    <select
                      className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/70"
                      onChange={(event) =>
                        setExplorerForm((previous) => ({
                          ...previous,
                          preferredDisposition: event.target.value as 'attachment' | 'inline'
                        }))
                      }
                      value={explorerForm.preferredDisposition}
                    >
                      <option value="attachment">attachment</option>
                      <option value="inline">inline</option>
                    </select>
                  </label>
                </div>
                {explorerError && (
                  <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {explorerError}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
                    disabled={explorerBusy !== null}
                    onClick={() => runExplorerAction('load-version')}
                    type="button"
                  >
                    {getExplorerActionLabel('load-version', explorerBusy)}
                  </button>
                  <button
                    className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
                    disabled={explorerBusy !== null}
                    onClick={() => runExplorerAction('authorize-source')}
                    type="button"
                  >
                    {getExplorerActionLabel('authorize-source', explorerBusy)}
                  </button>
                  <button
                    className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:text-slate-500"
                    disabled={explorerBusy !== null}
                    onClick={() => runExplorerAction('list-derivatives')}
                    type="button"
                  >
                    {getExplorerActionLabel('list-derivatives', explorerBusy)}
                  </button>
                  <button
                    className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:text-slate-500"
                    disabled={explorerBusy !== null}
                    onClick={() => runExplorerAction('load-manifest')}
                    type="button"
                  >
                    {getExplorerActionLabel('load-manifest', explorerBusy)}
                  </button>
                  <button
                    className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:text-slate-500 sm:col-span-2"
                    disabled={explorerBusy !== null}
                    onClick={() => runExplorerAction('authorize-delivery')}
                    type="button"
                  >
                    {getExplorerActionLabel('authorize-delivery', explorerBusy)}
                  </button>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                  Delivery reads and manifest reads succeed only after the version reaches
                  <span className="mx-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">published</span>.
                  Source authorization remains available earlier, unless the version becomes quarantined or purged.
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              {explorerResults.version !== undefined && (
                <ResourceCard payload={explorerResults.version} title="Version resource" />
              )}
              {explorerResults.sourceAuthorization !== undefined && (
                <ResourceCard payload={explorerResults.sourceAuthorization} title="Source authorization" />
              )}
              {explorerResults.derivatives !== undefined && (
                <ResourceCard payload={explorerResults.derivatives} title="Derivatives list" />
              )}
              {explorerResults.manifest !== undefined && (
                <ResourceCard payload={explorerResults.manifest} title="Manifest payload" />
              )}
              {explorerResults.deliveryAuthorization !== undefined && (
                <ResourceCard payload={explorerResults.deliveryAuthorization} title="Delivery authorization" />
              )}
              {explorerResults.version === undefined &&
                explorerResults.sourceAuthorization === undefined &&
                explorerResults.derivatives === undefined &&
                explorerResults.manifest === undefined &&
                explorerResults.deliveryAuthorization === undefined && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-slate-400">
                    No public-read response loaded yet. Use the explorer after an upload, or enter an existing asset and version.
                  </div>
                )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

export default App
