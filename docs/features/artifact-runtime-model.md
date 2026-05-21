# Artifact Runtime Model

Garden currently has three artifact-like surfaces. They are useful, but they are not one unified artifact system yet.

## 1. Document artifacts

Document artifacts are first-class durable artifacts.

Current shape:

- Postgres metadata: `document`, `document_version`, `document_edit`
- bytes in R2 `FILES`
- download/preview routes under `/api/documents/:id/...`
- UI renderer: `GardenArtifact` / `DocumentArtifact`
- agent tools: `generateDocx`, `editDocument`, `convertDocumentToPdf`

Strengths:

- durable storage
- versioning
- tracked changes
- docx/pdf preview
- thread ownership and download URLs

Limitations:

- document-specific data model
- not suitable as the generic home for web apps, generated HTML, images, code bundles, or issue deliverables

## 2. Issue work products

Issue work products are product deliverables, not file artifacts.

Current shape:

- Postgres metadata/body: `issue_work_product`
- fields: `type`, `title`, `body`, `payload`, review state, status
- created by issue-run tools such as `create_work_product` and `revise_work_product`
- surfaced in inbox/control-plane review flows

Strengths:

- good fit for reports, checklists, plans, proposed changes, and reviewable issue output
- tied directly to issue/run ledger
- easy to diff/revise as text/json

Limitations:

- no R2 object backing
- no generic file versioning
- no sandbox preview URL field
- not rendered through the artifact renderer

## 3. Sandbox files and previews

Sandbox output is ephemeral runtime workspace output.

Current shape:

- files live under `/workspace` in Cloudflare Sandbox
- agents can run dev/static servers with `sandboxStartProcess`
- agents can call `sandboxExposePort`
- when no hostname is provided, Garden uses Cloudflare Sandbox quick tunnels via `sandbox.tunnels.get(port)`

Strengths:

- great for generated web pages/apps, visual prototypes, demos, dashboards, and browser QA
- fast preview loop
- no hostname/config required with quick tunnels

Limitations:

- quick tunnel URLs are temporary
- URLs can change or die when sandbox/container restarts
- files are not automatically persisted to R2
- no database artifact row links sandbox output to chat, issue runs, or automation runs

## Desired unified model

Garden should introduce a generic artifact model instead of overloading document artifacts or issue work products.

Proposed shape:

- `artifact`
  - workspace id
  - owner/user/thread/issue/run references as optional foreign keys
  - kind: `document | web_preview | image | code_bundle | data | text | other`
  - title/description/status/review state
  - source: `sandbox | document_tool | issue_run | automation_run | upload`
- `artifact_version`
  - artifact id
  - version number
  - R2 key(s)
  - media type
  - filename
  - size/hash
  - optional preview metadata
- optional `artifact_preview`
  - runtime preview URL
  - port/process id/sandbox id
  - expiry/liveness metadata

Expected flow for sandbox-built artifacts:

1. Agent creates files in `/workspace`.
2. Agent starts a local server if visual preview is needed.
3. Agent exposes the server through quick tunnel for immediate review.
4. When accepted or finalized, Garden copies durable files from sandbox to R2.
5. Garden records an `artifact` + `artifact_version` row.
6. The UI renders durable artifact metadata and may show the live quick-tunnel preview only while available.

## Boundary rule

Quick tunnels are preview transport, not artifact storage. R2/Postgres are artifact storage. Issue work products are reviewable product outputs. Document artifacts are a specialized durable artifact implementation that should eventually become one kind under the generic artifact model.
