import { useCallback, useRef } from 'react'
import type { DocumentSnapshot } from '@garden/agent-runtime/src/documents/document-artifact-model'
import workspaceDocsClientSource from '../../../../../third_party/cloudflare-os/workspace-docs/client.js?raw'
import {
  WorkspaceDocsAdapter,
  type WorkspaceDocsEvent,
} from './workspace-docs-adapter'

const WORKSPACE_DOCS_CHANNEL = 'garden:workspace-docs:v1'

const workspaceDocsBootstrap = String.raw`
const WORKSPACE_DOCS_CHANNEL = "${WORKSPACE_DOCS_CHANNEL}";
let workspaceDocsRequestId = 0;
let workspaceDocsCallbacks = null;
const workspaceDocsPending = new Map();

class RpcTarget {}

function workspaceDocsRequest(method, args = []) {
  const requestId = String(++workspaceDocsRequestId);
  return new Promise((resolve, reject) => {
    workspaceDocsPending.set(requestId, { resolve, reject });
    parent.postMessage({ channel: WORKSPACE_DOCS_CHANNEL, kind: "request", requestId, method, args }, "*");
  });
}

addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.channel !== WORKSPACE_DOCS_CHANNEL) return;
  if (event.data.kind === "event") {
    if (event.data.event?.type === "presence") workspaceDocsCallbacks?.presence(event.data.event);
    else workspaceDocsCallbacks?.operation(event.data.event);
    return;
  }
  if (event.data.kind !== "response") return;
  const pending = workspaceDocsPending.get(event.data.requestId);
  if (!pending) return;
  workspaceDocsPending.delete(event.data.requestId);
  if (event.data.ok) pending.resolve(event.data.result);
  else pending.reject(new Error(event.data.error || "Workspace Docs request failed"));
});

const gadget = {
  subscribe(callback, client) {
    workspaceDocsCallbacks = callback;
    return workspaceDocsRequest("subscribe", [client]);
  },
  applyOperation(operation) {
    return workspaceDocsRequest("applyOperation", [operation]);
  },
  initializeBlocks(args) {
    return workspaceDocsRequest("initializeBlocks", [args]);
  },
  updatePresence() { return Promise.resolve(); },
  leavePresence() { return Promise.resolve(); },
};
`

/** Builds the isolated document that executes Cloudflare's client source unchanged. */
export function workspaceDocsFrameSource() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>${workspaceDocsBootstrap}</script><script>${workspaceDocsClientSource}</script></body></html>`
}

type WorkspaceDocsRequest = {
  channel: typeof WORKSPACE_DOCS_CHANNEL
  kind: 'request'
  requestId: string
  method: string
  args: unknown[]
}

/** Narrows postMessage traffic to requests emitted by the iframe bootstrap. */
function isWorkspaceDocsRequest(value: unknown): value is WorkspaceDocsRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<WorkspaceDocsRequest>
  return (
    request.channel === WORKSPACE_DOCS_CHANNEL &&
    request.kind === 'request' &&
    typeof request.requestId === 'string' &&
    typeof request.method === 'string' &&
    Array.isArray(request.args)
  )
}

/** Produces a cloneable error message without exposing request internals. */
function requestErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Workspace Docs request failed'
}

export function WorkspaceDocsEditor({
  documentId,
  initialSnapshot,
}: {
  documentId: string
  initialSnapshot: DocumentSnapshot
}) {
  const adapterRef = useRef<WorkspaceDocsAdapter | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  /** Sends one authoritative collaboration event into the isolated editor. */
  const pushEvent = useCallback(
    (frame: HTMLIFrameElement, event: WorkspaceDocsEvent) => {
      frame.contentWindow?.postMessage(
        { channel: WORKSPACE_DOCS_CHANNEL, kind: 'event', event },
        '*',
      )
    },
    [],
  )

  /** Owns the postMessage bridge and adapter lifetime without a React effect. */
  const attachFrame = useCallback(
    (frame: HTMLIFrameElement | null) => {
      cleanupRef.current?.()
      cleanupRef.current = null
      adapterRef.current?.dispose()
      adapterRef.current = null
      if (!frame) return

      const adapter = new WorkspaceDocsAdapter({
        documentId,
        initialSnapshot,
      })
      adapterRef.current = adapter

      const respond = (
        requestId: string,
        response: { ok: true; result: unknown } | { ok: false; error: string },
      ) => {
        frame.contentWindow?.postMessage(
          {
            channel: WORKSPACE_DOCS_CHANNEL,
            kind: 'response',
            requestId,
            ...response,
          },
          '*',
        )
      }

      /** Dispatches only the three calls the unmodified upstream client can make. */
      const onMessage = (event: MessageEvent<unknown>) => {
        if (
          event.source !== frame.contentWindow ||
          !isWorkspaceDocsRequest(event.data)
        ) {
          return
        }
        const request = event.data
        const operation = request.args[0]
        const task =
          request.method === 'subscribe'
            ? adapter.subscribe((next) => pushEvent(frame, next))
            : request.method === 'applyOperation' &&
                operation &&
                typeof operation === 'object'
              ? adapter.applyOperation(
                  operation as Parameters<
                    WorkspaceDocsAdapter['applyOperation']
                  >[0],
                )
              : request.method === 'initializeBlocks'
                ? Promise.reject(
                    new Error(
                      'Garden documents are initialized before the editor opens.',
                    ),
                  )
                : Promise.reject(
                    new Error(
                      `Unsupported Workspace Docs method: ${request.method}`,
                    ),
                  )
        void task.then(
          (result) => respond(request.requestId, { ok: true, result }),
          (error: unknown) =>
            respond(request.requestId, {
              ok: false,
              error: requestErrorMessage(error),
            }),
        )
      }

      window.addEventListener('message', onMessage)
      /** Starts source after the bridge listens so eager subscribe cannot race the ref. */
      frame.srcdoc = workspaceDocsFrameSource()
      cleanupRef.current = () => {
        window.removeEventListener('message', onMessage)
        adapter.dispose()
      }
    },
    [documentId, initialSnapshot, pushEvent],
  )

  return (
    <iframe
      ref={attachFrame}
      className="min-h-0 flex-1 border-0 bg-white"
      sandbox="allow-popups allow-scripts"
      title="Document editor"
    />
  )
}
