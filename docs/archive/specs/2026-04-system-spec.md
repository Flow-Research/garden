# Garden — system spec

**Status:** draft  
**Last updated:** 2026-04-23

This document defines the target system contract for Garden's agents.

It is informed by the reference prompts we reviewed, especially:

- the reference behavior prompt
- the reference desktop/workflow prompt
- the reference visualization prompt

These are reference specs, not product copy. Garden should adopt their useful operating patterns, capability surfaces, and rendering rules, then remap them to Garden's own runtime, filesystem, tools, and UI.

The goal is not a minimal prompt. The goal is a broad system contract that we can safely compress later.

## 1. Purpose

Garden needs a real system spec because the product is not "a chat box with a model behind it." The product is:

- a persistent agent runtime
- a workspace-scoped skills system
- a typed tool system
- a permissions and approvals layer
- a filesystem and sandbox execution surface
- a UI that makes all of that usable by non-technical and technical users

The system prompt is only one layer. The full system spec is the contract across prompt, runtime, tools, storage, and product surface.

## 2. Design rule

Build the spec as a **lossless union first**.

- If two source prompts say the same thing, merge them.
- If one is broader and one is sharper, keep both semantics.
- If one part is vendor-specific, rewrite the transport and keep the behavior.
- If a feature described by the prompt does not exist in Garden yet, treat it as a product/runtime requirement instead of deleting it.

The bias is to preserve capability now and strip later.

## 3. System layers

Garden's system spec should be split into these layers.

### 3.1 Core behavior

The base agent contract:

- how the agent reasons about tasks
- how it decides when to act vs ask
- how it verifies work
- how it handles ambiguity
- how it deals with current information
- how it responds when it cannot comply
- how it handles criticism and corrections

This is the durable operating contract that every Garden agent inherits.

### 3.2 Tone and formatting

Garden should carry the full tone/formatting guidance from the reference prompts, then compress later.

This includes:

- minimal formatting by default
- natural prose over bullets unless needed
- warm but direct tone
- non-condescending pushback
- short responses for simple questions
- restrained use of headers, lists, bold, emoji, and rhetorical flourishes

This is a prompt concern, but it should also inform product-authored copy and skill authoring guidance.

### 3.3 Safety and policy

Garden needs a first-class safety layer for:

- harmful content boundaries
- malware and exploit refusal
- weapons and dangerous substance refusal
- legal and financial framing
- mental-health-sensitive handling
- prompt-injection defense
- social-engineering defense
- privacy and secret handling
- destructive action rules

This is not just prompt text. It also needs runtime and UI support.

### 3.4 Workspace and filesystem model

Garden already has the right substrate:

- per-chat or per-agent Durable Object state
- DO-backed workspace state
- R2-backed files
- sandbox execution
- Linux filesystem inside Cloudflare Sandboxes

The system spec should explicitly define:

- what files the agent can see
- what files it can create
- what file operations need approval
- how artifacts are surfaced back to users
- how workspace state maps to the sandbox filesystem
- how chat/session state maps to workspace state

This is a direct analogue of the Cowork file model, but remapped to Think + Workspace + Sandbox instead of a desktop VM.

### 3.5 Tool contract

Garden should define a typed tool surface that the system prompt can rely on.

That contract needs categories for:

- connector tools
- workspace tools
- filesystem tools
- execution tools
- browser/web tools
- scheduling/automation tools
- visualization/rendering tools
- approval and artifact tools

The prompt should not pretend tools exist before the runtime exposes them.

### 3.6 Skills model

Skills are a core product primitive in Garden, not an implementation detail.

The system spec should define:

- how skills are loaded
- how they are injected into the agent context
- how skill triggers work
- how skill files and bundled assets are mounted
- how skills may reference tools
- how skills compose with the base system contract
- what cannot be overridden by a skill

This should align with the PRD's workspace-scoped Agent Skills model.

### 3.7 Visual runtime

The Visualize prompt is not just a style guide. It implies a product subsystem.

Garden's system spec should define a visual runtime for:

- diagrams
- interactive explainers
- mockups
- charts
- bounded UI objects
- rendered artifacts

That includes:

- allowed rendering primitives
- theme tokens
- dark-mode requirements
- safe HTML/SVG conventions
- event bridging back into chat
- file and artifact export rules

### 3.8 Approvals and autonomy

Garden's permission model in the PRD already points in this direction. The system spec should make it explicit:

- which actions can run automatically
- which actions require approval
- what counts as risky
- how the agent pauses and resumes
- how approval context is shown
- how trust levels change over time

### 3.9 Citation and provenance

Garden should define when the agent must show sources, including:

- web lookups
- workspace files
- connector content
- generated reports or summaries derived from external data

This needs product support, not just prompt wording.

## 4. Garden-native mapping

The prompt corpus maps cleanly to Garden's intended architecture.

### 4.1 Already supported in architecture

These are already present in the docs and at least partially in runtime:

- persistent agent runtime on Durable Objects
- workspace state near the agent
- sandboxed code execution with a real filesystem
- R2-backed file storage
- session persistence
- prompt assembly from persona, instructions, skills, tools, and context
- workspace-scoped skills
- per-agent permissions and approval flow

### 4.2 Clearly planned in the PRD but not yet fully built

- skills library and editor
- skill assignment flow
- approval inbox as a durable work primitive
- connector-backed typed tools
- audit log and invocation history
- command palette and richer workspace surfaces
- scheduled automations
- in-flow skill recommendation

### 4.3 Implied by the source prompts and needed for parity

- structured clarification tool
- explicit todo/progress tool surfaced in product
- artifact presentation surface
- file-delete and destructive-operation gating
- browser-use surface
- visual rendering subsystem
- plugin/connector discovery UX
- richer provenance/citation UI

## 5. What Garden needs to build

To facilitate the full system spec, Garden needs buildout across prompt, runtime, and product.

### 5.1 Prompt and prompt-assembly layer

Build:

- a Garden base system prompt assembled from stable sections rather than one giant string
- source-tagged imports or partials for behavior, tone, safety, and tool rules
- a hard separation between base system policy and skill-injected instructions
- a conflict-resolution rule for skill instructions vs system rules
- context budgeting rules so the prompt does not balloon uncontrollably

Current implementation in the runtime:

- base foundation prompt is assembled from stable sections
- agent identity/instructions and workspace context are injected as separate readonly cached blocks
- skills remain isolated in their own skill block and load on demand
- capability inventory, active-task context, and memory are still pending

### 5.2 Skill runtime

Build:

- skill storage and versioning in Postgres/R2
- skill assignment UI
- skill mounting into the agent runtime
- bundled file support for skill assets and templates
- trigger metadata enforcement (`when-to-use`, scope, tool dependencies)
- a system-level guardrail so skills cannot override base safety/runtime rules
- explicit invalidation semantics for live skill inventory; writes through Garden APIs may refresh active sessions immediately, but out-of-band database changes need a separate versioning or realtime invalidation mechanism

### 5.3 Tool registry and typed tool loading

Build:

- a typed capability registry for all callable tools
- runtime tool descriptors with schemas, trust level, and source binding
- connector tool adapters loaded per workspace/user/agent
- workspace/file tools exposed consistently alongside connector tools
- audit logging for every tool invocation

### 5.4 Filesystem and artifact layer

Build:

- a first-class file browser surface for the agent workspace
- clear mapping between workspace storage and sandbox paths
- file create/read/update/delete policy enforcement
- artifact presentation in chat and tab surfaces
- file previews for common artifact types
- export/download/share flows for generated artifacts

### 5.5 Approval and autonomy layer

Build:

- approval objects with typed action payloads
- interrupt/resume semantics for pending actions
- permission prompts that preserve tool arguments and rationale
- a policy engine over the current runtime trust levels (`auto`, `allow`, `ask`) plus connector risk classes (`read`, `write`, `send_external`, `destructive`)
- a durable action log visible to the user

### 5.6 Browser and web retrieval layer

Build:

- first-class web search and fetch tools
- browser-use or equivalent browser automation when the task needs interaction, not just retrieval
- current-information policy hooks so unstable facts trigger search automatically
- source capture and citation formatting

### 5.7 Visual runtime

Build:

- a rendering surface for safe HTML/SVG output
- theme tokens shared with the main app shell
- event bridge from rendered widgets back into chat actions
- CSP and sanitization rules
- artifact persistence for generated visuals
- a visual skill or built-in visual toolset based on the Visualize prompt

### 5.8 Product surfaces

Build:

- skills tab and editor
- approvals in inbox and issue surfaces
- runs/activity tab with tool and file activity
- artifact/file panel
- connector/tool permissions panel
- visual output surface inside chat/workspace tabs
- scheduled task UI

### 5.9 Observability and evals

Build:

- prompt/version tracking
- per-run prompt snapshot storage
- tool call tracing
- failure taxonomy
- eval suites for formatting, approvals, tool use, refusal behavior, and visual output quality

Without this, the system spec will drift.

## 6. Recommended implementation order

Garden should build toward the system spec in this order.

### Phase 1 — core contract

- base system prompt sections
- prompt assembly pipeline
- safety and destructive-action rules
- typed tool registry
- approval object model

### Phase 2 — skills and tools

- skill storage, assignment, injection
- connector capability loading
- audit logging
- file/artifact surfacing

### Phase 3 — workspace and browser parity

- richer filesystem surfaces
- browser/web tools
- scheduling/task primitives
- source and provenance UX

### Phase 4 — visual runtime

- HTML/SVG rendering subsystem
- interaction bridge
- chart/mockup/diagram support
- visual skill layer

### Phase 5 — optimization and compression

- collapse duplicated prompt sections
- trim wording after behavior is covered by tests
- reduce context size
- promote stable sections into reusable prompt partials

## 7. Immediate next deliverables

The next concrete repo work should be:

1. Add this system spec document.
2. Define the Garden base prompt sections as discrete source files under `packages/agent-runtime`.
3. Define the typed tool registry shape.
4. Implement skill loading and assignment end to end.
5. Add approval and artifact records to the control plane.
6. Add a visual-runtime design/technical doc before implementation.

## 8. Non-goal

The goal of this document is not to freeze wording.

The goal is to freeze **scope**:

- what the system must be able to do
- what runtime and product surfaces it depends on
- what should remain in the base system contract
- what belongs in skills

Once that scope exists, we can safely simplify wording later without accidentally shrinking the product.
