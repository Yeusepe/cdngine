/**
 * Purpose: Builds the operator-facing HTML console and mounts the audited operator API so trusted users can inspect diagnostics, review audit history, and trigger recovery actions from one product surface.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/security-model.md
 * - docs/runbooks/README.md
 * - docs/api-surface.md
 * External references:
 * - https://hono.dev/docs
 * - https://developer.mozilla.org/en-US/docs/Web/API/FormData
 * Tests:
 * - apps/operator/test/operator-app.test.mjs
 */

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { RequestActorAuthenticator } from '@cdngine/auth';
import {
  authenticationMiddleware,
  createApiApp,
  createInMemoryOperatorRouteDependencies,
  operatorActionRequestSchema,
  registerOperatorRoutes,
  type OperatorAction,
  type OperatorActionRequest,
  type OperatorActionAccepted,
  type OperatorAuditEvent,
  type OperatorControlStore,
  type VersionDiagnostics
} from '@cdngine/api';

export interface CreateOperatorAppOptions {
  auth?: RequestActorAuthenticator;
  store?: OperatorControlStore;
  title?: string;
}

interface OperatorPageState {
  acceptedAction?: OperatorActionAccepted;
  assetId?: string;
  auditEvents?: OperatorAuditEvent[];
  diagnostics?: VersionDiagnostics | null;
  errorMessage?: string;
  flashAction?: string;
  title: string;
  versionId?: string;
}

const ACTION_LABELS: Record<OperatorAction, string> = {
  purge: 'Purge version',
  quarantine: 'Quarantine version',
  release: 'Release quarantine',
  reprocess: 'Replay from canonical source'
};

function isActionAllowed(
  action: OperatorAction,
  diagnostics: VersionDiagnostics | null | undefined
) {
  const lifecycleState = diagnostics?.lifecycleState;

  if (!lifecycleState) {
    return false;
  }

  if (action === 'reprocess') {
    return ['canonical', 'published', 'failed_retryable'].includes(lifecycleState);
  }

  if (action === 'quarantine') {
    return lifecycleState !== 'quarantined' && lifecycleState !== 'purged';
  }

  if (action === 'release') {
    return lifecycleState === 'quarantined';
  }

  return lifecycleState !== 'purged';
}

function getRunbookLinks(diagnostics: VersionDiagnostics | null | undefined) {
  const links = [
    {
      href: '/docs/runbooks/replay-operations.md',
      label: 'Replay operations'
    }
  ];

  if (diagnostics?.lifecycleState === 'quarantined') {
    links.unshift({
      href: '/docs/runbooks/quarantine-and-release.md',
      label: 'Quarantine and release'
    });
  }

  if (diagnostics?.workflow.state === 'queued' || diagnostics?.workflow.state === 'running') {
    links.push({
      href: '/docs/runbooks/workflow-backlog.md',
      label: 'Workflow backlog'
    });
  }

  return links;
}

function actionButtonLabel(action: OperatorAction, flashAction: string | undefined) {
  if (flashAction === action) {
    return `${ACTION_LABELS[action]} queued`;
  }

  return ACTION_LABELS[action];
}

function renderActionForm(
  action: OperatorAction,
  state: OperatorPageState
) {
  const enabled = isActionAllowed(action, state.diagnostics);

  return html`<form class="action-card" method="post" action="/assets/${state.assetId}/versions/${state.versionId}/actions/${action}">
    <div class="action-card-header">
      <h3>${ACTION_LABELS[action]}</h3>
      <span class="${enabled ? 'badge badge-ready' : 'badge badge-blocked'}">
        ${enabled ? 'Available' : 'Blocked'}
      </span>
    </div>
    <label class="field-label" for="${action}-reason">Why are you taking this action?</label>
    <textarea class="textarea" id="${action}-reason" name="reason" rows="4" required placeholder="Record the operator reason that should survive audit review."></textarea>
    <label class="field-label" for="${action}-evidence">Evidence or ticket reference</label>
    <input class="input" id="${action}-evidence" name="evidenceReference" type="text" placeholder="incident://INC-123 or review://approval-456" />
    <button class="button" type="submit" ${enabled ? '' : 'disabled'}>
      ${actionButtonLabel(action, state.flashAction)}
    </button>
  </form>`;
}

function renderAuditEvents(auditEvents: OperatorAuditEvent[] | undefined) {
  if (!auditEvents || auditEvents.length === 0) {
    return html`<p class="empty">No operator actions have been recorded for this version yet.</p>`;
  }

  return html`<div class="timeline">
    ${auditEvents.map(
      (event) => html`<article class="timeline-item">
        <div class="timeline-row">
          <strong>${ACTION_LABELS[event.action]}</strong>
          <span class="muted">${event.recordedAt.toISOString()}</span>
        </div>
        <p class="muted">Actor ${event.actorSubject} · Operation ${event.operationId}</p>
        <p>${event.reason}</p>
        ${event.evidenceReference
          ? html`<p class="muted">Evidence ${event.evidenceReference}</p>`
          : html``}
        ${event.workflowId ? html`<p class="muted">Workflow ${event.workflowId}</p>` : html``}
      </article>`
    )}
  </div>`;
}

function renderDiagnostics(state: OperatorPageState) {
  if (!state.assetId || !state.versionId) {
    return html`<section class="panel">
      <h2>Load a version</h2>
      <p class="muted">
        Enter an asset and version to inspect the current lifecycle, workflow, source replay state, and audit history.
      </p>
    </section>`;
  }

  if (!state.diagnostics) {
    return html`<section class="panel">
      <h2>Version not found</h2>
      <p class="muted">No operator-visible version matched ${state.assetId} / ${state.versionId}.</p>
    </section>`;
  }

  return html`<section class="panel grid">
      <div>
        <h2>Version diagnostics</h2>
        <p class="muted">Asset ${state.assetId} · Version ${state.versionId}</p>
      </div>
      <div class="summary-grid">
        <div class="summary-card">
          <span class="summary-label">Lifecycle</span>
          <strong>${state.diagnostics.lifecycleState}</strong>
        </div>
        <div class="summary-card">
          <span class="summary-label">Workflow</span>
          <strong>${state.diagnostics.workflow.state}</strong>
          ${state.diagnostics.workflow.workflowId
            ? html`<span class="muted">${state.diagnostics.workflow.workflowId}</span>`
            : html``}
        </div>
        <div class="summary-card">
          <span class="summary-label">Publication status</span>
          <strong>${state.diagnostics.publication?.manifestType ?? 'Not published'}</strong>
          <span class="muted">
            ${typeof state.diagnostics.publication?.derivativeCount === 'number'
              ? `${state.diagnostics.publication.derivativeCount} derivatives`
              : 'No derivative projection'}
          </span>
        </div>
        <div class="summary-card">
          <span class="summary-label">Source restore</span>
          <strong>${state.diagnostics.sourceRestore?.repositoryEngine ?? 'Not materialized'}</strong>
          ${state.diagnostics.sourceRestore?.restoredPath
            ? html`<span class="muted">${state.diagnostics.sourceRestore.restoredPath}</span>`
            : html``}
        </div>
      </div>
      <div class="json-links">
        <a class="link" href="/v1/operator/assets/${state.assetId}/versions/${state.versionId}/diagnostics">Diagnostics JSON</a>
        <a class="link" href="/v1/operator/assets/${state.assetId}/versions/${state.versionId}/audit">Audit JSON</a>
      </div>
    </section>
    <section class="panel">
      <h2>Operator runbooks</h2>
      <div class="runbook-list">
        ${getRunbookLinks(state.diagnostics).map(
          (link) => html`<a class="runbook-link" href="${link.href}">${link.label}</a>`
        )}
      </div>
    </section>
    <section class="panel">
      <h2>Recent audit trail</h2>
      ${renderAuditEvents(state.auditEvents)}
    </section>
    <section class="panel">
      <h2>Recovery actions</h2>
      <div class="actions-grid">
        ${renderActionForm('reprocess', state)}
        ${renderActionForm('quarantine', state)}
        ${renderActionForm('release', state)}
        ${renderActionForm('purge', state)}
      </div>
    </section>`;
}

function renderPage(state: OperatorPageState) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${state.title}</title>
        <style>
          :root {
            color-scheme: dark;
            --background: #07111f;
            --surface: rgba(10, 21, 39, 0.88);
            --surface-border: rgba(148, 163, 184, 0.2);
            --text: #e5eef8;
            --muted: #94a3b8;
            --accent: #38bdf8;
            --accent-strong: #0ea5e9;
            --danger: #f87171;
            --success: #34d399;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: Inter, system-ui, sans-serif;
            background:
              radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 38%),
              linear-gradient(180deg, #07111f 0%, #020617 100%);
            color: var(--text);
          }
          main { max-width: 1180px; margin: 0 auto; padding: 48px 24px 64px; }
          h1, h2, h3, p { margin: 0; }
          .hero { display: grid; gap: 16px; margin-bottom: 24px; }
          .eyebrow {
            display: inline-flex;
            width: fit-content;
            padding: 6px 12px;
            border-radius: 999px;
            border: 1px solid rgba(56, 189, 248, 0.3);
            background: rgba(14, 165, 233, 0.12);
            color: #bae6fd;
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          .hero p { max-width: 760px; color: var(--muted); line-height: 1.6; }
          .stack { display: grid; gap: 20px; }
          .panel {
            display: grid;
            gap: 16px;
            padding: 24px;
            border: 1px solid var(--surface-border);
            border-radius: 20px;
            background: var(--surface);
            backdrop-filter: blur(18px);
          }
          .search-grid, .summary-grid, .actions-grid {
            display: grid;
            gap: 16px;
          }
          .search-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); align-items: end; }
          .summary-grid { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
          .actions-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
          .summary-card, .action-card, .timeline-item {
            display: grid;
            gap: 10px;
            padding: 18px;
            border-radius: 16px;
            border: 1px solid rgba(148, 163, 184, 0.16);
            background: rgba(15, 23, 42, 0.68);
          }
          .summary-label, .field-label, .muted {
            color: var(--muted);
            font-size: 14px;
          }
          .field-label { font-weight: 600; }
          .input, .textarea, .button, .search-button {
            border-radius: 12px;
            border: 1px solid rgba(148, 163, 184, 0.2);
            background: rgba(2, 6, 23, 0.82);
            color: var(--text);
            font: inherit;
          }
          .input, .textarea {
            width: 100%;
            padding: 12px 14px;
          }
          .textarea { resize: vertical; min-height: 110px; }
          .button, .search-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 46px;
            padding: 0 16px;
            background: linear-gradient(135deg, var(--accent-strong), var(--accent));
            border-color: transparent;
            color: white;
            font-weight: 700;
            cursor: pointer;
          }
          .button[disabled] {
            cursor: not-allowed;
            opacity: 0.45;
          }
          .timeline { display: grid; gap: 12px; }
          .timeline-row, .action-card-header, .json-links {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            justify-content: space-between;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 28px;
            padding: 0 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .badge-ready { background: rgba(52, 211, 153, 0.14); color: #a7f3d0; }
          .badge-blocked { background: rgba(248, 113, 113, 0.14); color: #fecaca; }
          .alert {
            padding: 14px 16px;
            border-radius: 14px;
            border: 1px solid rgba(56, 189, 248, 0.28);
            background: rgba(14, 165, 233, 0.12);
          }
          .alert-error {
            border-color: rgba(248, 113, 113, 0.28);
            background: rgba(248, 113, 113, 0.12);
          }
          .runbook-list, .json-links {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
          }
          .link, .runbook-link {
            color: #bae6fd;
            text-decoration: none;
          }
          .empty { color: var(--muted); }
          @media (max-width: 720px) {
            main { padding: 32px 16px 48px; }
            .panel { padding: 20px; border-radius: 18px; }
          }
        </style>
      </head>
      <body>
        <main>
          <section class="hero">
            <span class="eyebrow">CDNgine · operator console</span>
            <h1>Operator console</h1>
            <p>
              Inspect immutable version diagnostics, review audit evidence, and queue recovery actions without leaving the trusted operator surface.
            </p>
          </section>
          <div class="stack">
            <section class="panel">
              <h2>Lookup version</h2>
              <form method="get" action="/">
                <div class="search-grid">
                  <label>
                    <span class="field-label">Asset ID</span>
                    <input class="input" name="assetId" type="text" value="${state.assetId ?? ''}" required />
                  </label>
                  <label>
                    <span class="field-label">Version ID</span>
                    <input class="input" name="versionId" type="text" value="${state.versionId ?? ''}" required />
                  </label>
                  <button class="search-button" type="submit">Load diagnostics</button>
                </div>
              </form>
            </section>
            ${state.acceptedAction
              ? html`<section class="alert">
                  Queued operator action: ${state.acceptedAction.action} · Operation ${state.acceptedAction.operationId}
                </section>`
              : state.flashAction
                ? html`<section class="alert">Queued operator action: ${state.flashAction}</section>`
                : html``}
            ${state.errorMessage
              ? html`<section class="alert alert-error">${state.errorMessage}</section>`
              : html``}
            ${renderDiagnostics(state)}
          </div>
        </main>
      </body>
    </html>`;
}

async function readActionRequest(context: {
  req: {
    header: (name: string) => string | undefined;
    raw: Request;
  };
}) {
  const contentType = context.req.header('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return context.req.raw.json();
  }

  const form = await context.req.raw.formData();

  return {
    evidenceReference:
      typeof form.get('evidenceReference') === 'string' && form.get('evidenceReference')
        ? String(form.get('evidenceReference'))
        : undefined,
    reason: String(form.get('reason') ?? '')
  };
}

async function resolvePageState(
  store: OperatorControlStore,
  state: Pick<OperatorPageState, 'acceptedAction' | 'assetId' | 'errorMessage' | 'flashAction' | 'title' | 'versionId'>
): Promise<OperatorPageState> {
  if (!state.assetId || !state.versionId) {
    return state;
  }

  const diagnostics = await store.getDiagnostics(state.assetId, state.versionId);
  const auditEvents = diagnostics
    ? await store.getAuditEvents(state.assetId, state.versionId)
    : undefined;

  return {
    ...state,
    ...(auditEvents ? { auditEvents } : {}),
    diagnostics
  };
}

async function performAction(
  store: OperatorControlStore,
  action: OperatorAction,
  assetId: string,
  versionId: string,
  actorSubject: string,
  request: OperatorActionRequest
) {
  if (action === 'reprocess') {
    return store.reprocessVersion(assetId, versionId, actorSubject, request);
  }

  if (action === 'quarantine') {
    return store.quarantineVersion(assetId, versionId, actorSubject, request);
  }

  if (action === 'release') {
    return store.releaseVersion(assetId, versionId, actorSubject, request);
  }

  return store.purgeVersion(assetId, versionId, actorSubject, request);
}

export function createOperatorApp(options: CreateOperatorAppOptions = {}) {
  const app = new Hono();
  const store = options.store ?? createInMemoryOperatorRouteDependencies().store;
  const title = options.title ?? 'CDNgine operator console';
  const requireOperator = authenticationMiddleware('operator', options.auth);

  app.get('/', requireOperator, async (context) => {
    const assetId = context.req.query('assetId');
    const versionId = context.req.query('versionId');
    const flashAction = context.req.query('flash') ?? undefined;
    const pageState = await resolvePageState(store, {
      title,
      ...(assetId ? { assetId } : {}),
      ...(flashAction ? { flashAction } : {}),
      ...(versionId ? { versionId } : {})
    });

    return context.html(renderPage(pageState));
  });

  app.post('/assets/:assetId/versions/:versionId/actions/:action', requireOperator, async (context) => {
    const assetId = context.req.param('assetId');
    const versionId = context.req.param('versionId');
    const action = context.req.param('action') as OperatorAction;
    const actor = context.get('actor');
    const parsed = operatorActionRequestSchema.safeParse(await readActionRequest(context));

    if (!parsed.success) {
      const pageState = await resolvePageState(store, {
        assetId,
        errorMessage: parsed.error.issues.map((issue) => issue.message).join('; '),
        title,
        versionId
      });

      return context.html(renderPage(pageState), 400);
    }

    if (!actor) {
      const pageState = await resolvePageState(store, {
        assetId,
        errorMessage: 'Operator authentication is required before privileged actions can run.',
        title,
        versionId
      });

      return context.html(renderPage(pageState), 401);
    }

    const acceptedAction = await performAction(
      store,
      action,
      assetId,
      versionId,
      actor.subject,
      {
        reason: parsed.data.reason,
        ...(parsed.data.evidenceReference ? { evidenceReference: parsed.data.evidenceReference } : {})
      }
    );

    const redirectUrl = new URL('http://localhost/');
    redirectUrl.searchParams.set('assetId', assetId);
    redirectUrl.searchParams.set('versionId', versionId);
    redirectUrl.searchParams.set('flash', action);

    return context.redirect(`${redirectUrl.pathname}${redirectUrl.search}`, 302);
  });

  app.route(
    '/',
    createApiApp({
      ...(options.auth ? { auth: options.auth } : {}),
      registerOperatorRoutes(operatorApi) {
        registerOperatorRoutes(operatorApi, { store });
      }
    })
  );

  return app;
}
