/**
 * All copy + structured data for the /architecture page.
 *
 * Written to be read by someone who has never touched Cloudflare's stack. Define
 * a thing before using its name, prefer plain words over jargon, and keep it
 * honest to the code (docs/core/technical.md, project-think-cloudflare.md,
 * chat-runtime-model.md). Component shapes here are consumed by the page and the
 * diagram components — keep the keys stable when editing copy.
 */

export const architectureCopy = {
  eyebrow: 'How Garden is built',
  title: 'Agents that keep working when things go wrong',
  lede: 'Garden runs AI agents for a whole company at once. They run on servers, not in your browser tab, and a single task can take minutes and call out to other apps. Servers crash, requests time out, machines go to sleep. The job of this architecture is to make all of that survivable. This page walks through the pieces, what each one actually is, and why we picked them.',
  thesis:
    'You can get a demo working by calling a model in a loop. Getting it to work for real users is a different problem: the work has to survive crashes, thousands of people have to run agents at the same time without stepping on each other, and you do not want to hand-write the plumbing for any of it. We get that plumbing from Cloudflare instead of building it.',
}

// ---------------------------------------------------------------------------
// Table of contents (ids must match the section components)
// ---------------------------------------------------------------------------
export type TocItem = { id: string; label: string }

export const archToc: TocItem[] = [
  { id: 'blocks', label: 'The building blocks' },
  { id: 'planes', label: 'How it fits together' },
  { id: 'actors', label: 'Why each agent is isolated' },
  { id: 'durable', label: 'Surviving crashes' },
  { id: 'lifecycle', label: 'Following a request' },
  { id: 'loops', label: 'Where loops are going' },
  { id: 'execution', label: 'Running code & tools' },
  { id: 'connectors', label: 'Outside apps & permissions' },
  { id: 'skills', label: 'What the agent knows' },
  { id: 'ecosystem', label: 'Standing on the AI SDK' },
  { id: 'contrast', label: 'Why not just a script?' },
]

// ---------------------------------------------------------------------------
// Building blocks — what each primitive actually is
// ---------------------------------------------------------------------------
export type BuildingBlock = {
  id: string
  name: string
  kind: string
  what: string
  state: string
  garden: string
}

export const buildingBlocks: BuildingBlock[] = [
  {
    id: 'workers',
    name: 'Workers',
    kind: 'serverless compute',
    what: 'Small functions that run on Cloudflare’s network instead of a server you rent. They start when a request comes in, run near the user, and cost nothing when idle. There is no machine to keep alive or patch.',
    state: 'None of their own. A Worker answers a request and forgets it. Anything that needs to be remembered lives in one of the pieces below.',
    garden: 'The web app, its API, and the connector proxy are all Workers.',
  },
  {
    id: 'durable-objects',
    name: 'Durable Objects',
    kind: 'a Worker with memory',
    what: 'A Worker that has a name and remembers things. You look one up by name, and Cloudflare promises exactly one copy is running for that name anywhere in the world, handling one request at a time. People call this the actor model: a name, a single line of execution, and private storage, all in one place.',
    state: 'Built in. Each object gets its own little SQLite database that sticks around between requests and restarts. No outside cache or lock needed to stay consistent.',
    garden: 'Every agent, every chat, and every task run is its own Durable Object, so they cannot collide.',
  },
  {
    id: 'workflows',
    name: 'Workflows',
    kind: 'crash-proof execution',
    what: 'A way to run long jobs in steps. Each step’s result gets saved. If the server dies, the request times out, or the job sleeps for a week waiting on something, it picks up from the last finished step instead of starting over. Retrying and waiting are handled for you.',
    state: 'The progress is the state. It is saved between steps and survives failure on its own.',
    garden: 'Each task run and automation run is a Workflow. The workflow’s id is the run id, so starting the same run twice is harmless.',
  },
  {
    id: 'think',
    name: 'Think',
    kind: 'the agent loop',
    what: 'Cloudflare’s agent runtime, which runs inside a Durable Object. It holds one live conversation: the message history, the loop of calling the model and running tools, streaming the reply back to the screen, and recovering if a turn breaks. It is built on the Vercel AI SDK, so it works with any model provider.',
    state: 'Keeps the conversation (messages, cached prompt, tool wiring) in its Durable Object’s storage. We call a child Think instance a “facet”: one per chat or run.',
    garden: 'A chat, a task run, and an automation run are each a Think facet under one parent agent.',
  },
  {
    id: 'codemode',
    name: 'codemode',
    kind: 'tools as code',
    what: 'Instead of the model picking one tool at a time, it writes a short JavaScript snippet that calls several, run in a locked-down sandbox. Faster, and it can chain steps together.',
    state: 'Thrown away after it runs. It reaches tools through an API we hand it, not a shared disk.',
    garden: 'Available to chats and automations through the LOADER binding.',
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    kind: 'a real container',
    what: 'A genuine Linux container with a filesystem, where the agent can run shell commands and real programs. For work that needs an operating system, not just JavaScript.',
    state: 'Has its own files under /workspace, separate from the codemode world.',
    garden: 'Reached through our own sandbox tools and the Sandbox binding.',
  },
  {
    id: 'mcp',
    name: 'MCP',
    kind: 'a tool standard',
    what: 'Model Context Protocol. An open standard for handing outside tools (Gmail, GitHub, search) to an agent through one common interface, so every connector is not a one-off integration.',
    state: 'Each connection is a session. We run those sessions in a dedicated proxy.',
    garden: 'Connectors register as MCP servers and the proxy brokers the calls.',
  },
  {
    id: 'postgres',
    name: 'Postgres',
    kind: 'the database',
    what: 'A normal serverless SQL database (Neon), queried through a typed query builder (Drizzle). The boring, reliable source of truth.',
    state: 'The lasting record of anything you can list or search: users, agents, chats, runs, permissions.',
    garden: 'Every list and permission check reads Postgres, never an agent’s in-memory state.',
  },
  {
    id: 'r2',
    name: 'R2',
    kind: 'file storage',
    what: 'Object storage for files, like S3 but without the egress bill.',
    state: 'Durable storage, looked up by key.',
    garden: 'Holds uploads, generated documents, and skill bundles.',
  },
]

// ---------------------------------------------------------------------------
// Three planes
// ---------------------------------------------------------------------------
export type Plane = {
  id: string
  name: string
  runtime: string
  blurb: string
  nodes: string[]
}

export const planes: Plane[] = [
  {
    id: 'control',
    name: 'The record',
    runtime: 'Postgres',
    blurb: 'Everything you can list, open, or check permissions on lives in a normal database. The screen reads from here. It is the part that never forgets.',
    nodes: ['Users & workspaces', 'Agents', 'Chats', 'Tasks & runs', 'Automations', 'Permissions', 'Skills', 'Documents'],
  },
  {
    id: 'agent',
    name: 'The agents',
    runtime: 'Durable Objects + Think',
    blurb: 'The live, thinking part. Each agent is one always-addressable instance you reach by name. Every chat or task it works on runs in its own isolated child, so two conversations never trip over each other.',
    nodes: ['The agent (parent)', 'a chat', 'a task run', 'an automation run'],
  },
  {
    id: 'execution',
    name: 'The work',
    runtime: 'Workflows · code · containers · tools',
    blurb: 'Where things actually get done. Long jobs run as crash-proof workflows, code runs in a sandbox, files go to storage, and outside apps are reached through connectors.',
    nodes: ['Workflow', 'code execution', 'Linux container', 'connector tools', 'file storage'],
  },
]

// ---------------------------------------------------------------------------
// Actor model (the agent + its children)
// ---------------------------------------------------------------------------
export const actorModel = {
  intro:
    'Each agent is one Durable Object: a named instance with its own memory that handles one thing at a time. Think of it as the agent’s home base.',
  why: 'When you open a chat or kick off a task, it does not run inside that home base. It runs in a separate child instance with its own memory. Two chats cannot read or corrupt each other because they are literally different objects. When something does need to be shared, we share that one thing on purpose, rather than letting everything bleed together.',
  parent: {
    id: 'agent',
    name: 'The agent',
    sub: 'Holds the identity, checks who is allowed in, and hands each chat or task to its own child.',
  },
  facets: [
    { id: 'chat', name: 'A chat', key: 'one per conversation', sub: 'A single back-and-forth with its own history, files, and tools.' },
    { id: 'task', name: 'A task run', key: 'one per task', sub: 'A unit of assigned work, with the tools to do it and a record of what it produced.' },
    { id: 'automation', name: 'An automation run', key: 'one per run', sub: 'A scheduled job that runs on its own and reports back when done.' },
  ],
  note: 'Chats do not get their own top-level agent. The browser connects to the agent and asks for a child for that chat. The same thing happens on the server. The database holds the chat’s details; the child holds the live conversation.',
}

// ---------------------------------------------------------------------------
// Surviving crashes
// ---------------------------------------------------------------------------
export const durable = {
  intro:
    'A task run can take minutes and call slow outside services. Plenty can go wrong in that window. We wrap each run in a Workflow so the platform handles recovery, and we resist the urge to build a second safety net on top of it.',
  rules: [
    {
      title: 'The run id is the workflow id',
      body: 'Starting the same run twice does not create two runs, and you can find a run later to resume or cancel it.',
    },
    {
      title: 'Let Think carry the turn',
      body: 'Server-driven turns go through Think’s built-in durable submissions instead of a hand-rolled waiter that we would have to keep correct.',
    },
    {
      title: 'No second safety net',
      body: 'No extra queue between the agent and the workflow, no manual save-and-replay, no background cleanup script. If the platform already guarantees it, we do not rebuild it.',
    },
    {
      title: 'Work with the SDK, not around it',
      body: 'We do not patch the SDK’s internals or swap a live chat out from under itself. That is how you get races nobody can reproduce.',
    },
  ],
}

// ---------------------------------------------------------------------------
// Where workflows / loops are going (the deeper vision)
// ---------------------------------------------------------------------------
export const workflowsVision = {
  intro:
    'Right now a Workflow makes one run survive a crash. That is the floor, not the ceiling. Where this is headed: the automation itself is the thing that matters, and a run is just one durable attempt to push it forward.',
  unit: 'An automation is not a single task. It has instructions, its own files, access to a knowledge base, tools, a cadence, a history of past runs, and a strategy that changes over time. Each run wakes up, advances it a little, and leaves the next run a better starting point.',
  loop: 'Today a run ends by handing back a report. We want it to end by committing progress instead: what it found, what it changed, the evidence behind it, and what it intends to do next. The following run reads that and continues. The agent picks its own next move from the gaps, rather than us scripting the steps.',
  principles: [
    {
      id: 'observe',
      title: 'Observe, don’t impose',
      body: 'The runtime should not pre-chew context and spoon-feed it to the agent. The agent walks the knowledge graph, the filesystem, the web, and the sandbox itself. Everything it does is written to an event ledger, so you can see what it actually did instead of guessing. When you debug a run, you read the trace, not the UI.',
    },
    {
      id: 'primitives',
      title: 'Few open primitives, not a menu of tools',
      body: 'A drawer full of pre-shaped tools (graph_neighbors, graph_find_by_ticker, …) is us deciding in advance which questions the agent may ask. Better to give it sight into the real structure plus one open primitive it shapes per question, and conventions it can opt into. The test for any new tool: am I handing it a capability it shapes, or deciding the question for it? Reads stay open. Writes stay a deliberate, staged-commit boundary.',
    },
    {
      id: 'long',
      title: 'Long-running is normal',
      body: 'A run can take minutes or wait days on something. That is fine. No arbitrary timeouts, no polling loops, no heartbeat writes to fake progress. Finish on real events and durable state changes, and let the platform’s own budget govern the long waits.',
    },
    {
      id: 'ledger',
      title: 'A separate place for problems',
      body: 'When the agent hits something wrong (broken data, a stale source, an assumption it can’t verify) it logs that to an issue ledger a human actually reads, not buried in the trace firehose. Tracing is for what happened; the ledger is for what someone should look at.',
    },
  ],
  status: 'Some of this exists today (durable runs, the event ledger, the sandbox). The progress-and-next-intent contract and fully agent-driven traversal are the direction, not the current state. Calling that out so nobody reads this as already shipped.',
}

// ---------------------------------------------------------------------------
// Following a request (data flows)
// ---------------------------------------------------------------------------
export type FlowNodeData = { label: string; tone?: 'default' | 'moss' | 'amber' }

export const requestPath: FlowNodeData[] = [
  { label: 'Browser' },
  { label: 'the agent', tone: 'moss' },
  { label: 'the chat', tone: 'moss' },
  { label: 'model + tools' },
  { label: 'reply streams back' },
]

export type FlowStep = { actor: string; title: string; detail: string }
export type Flow = { id: string; label: string; summary: string; steps: FlowStep[] }

export const flows: Flow[] = [
  {
    id: 'task',
    label: 'A task run',
    summary: 'Assigned work that needs to finish even if a server dies halfway.',
    steps: [
      { actor: 'Server', title: 'A run is created', detail: 'A row goes into the database marking the task as running.' },
      { actor: 'Agent', title: 'The agent is told to start', detail: 'The server calls the agent that owns the task.' },
      { actor: 'Workflow', title: 'A workflow begins', detail: 'From here the run is crash-proof and can resume or be cancelled.' },
      { actor: 'Workflow', title: 'It drives each turn', detail: 'The workflow asks the agent to take the next turn, over and over.' },
      { actor: 'Child', title: 'The agent works', detail: 'The task’s child instance thinks, calls tools, and saves what it makes.' },
      { actor: 'Workflow', title: 'It finishes', detail: 'When the turn reports done, the run is closed. Retries and waiting were the workflow’s job.' },
    ],
  },
  {
    id: 'automation',
    label: 'An automation',
    summary: 'A scheduled job. Same machinery as a task, different trigger.',
    steps: [
      { actor: 'Schedule', title: 'A timer fires', detail: 'A small scheduler object wakes up on its own clock.' },
      { actor: 'Server', title: 'A run is created', detail: 'A row goes into the database for this automation run.' },
      { actor: 'Agent', title: 'The agent is told to start', detail: 'Same handoff as a task run.' },
      { actor: 'Workflow', title: 'A workflow runs the turn', detail: 'The crash-proof boundary is identical to a task.' },
      { actor: 'Child', title: 'The agent works and reports', detail: 'It runs against the automation’s instructions and finishes.' },
    ],
  },
  {
    id: 'chat',
    label: 'A live chat',
    summary: 'You are sitting there waiting, so this one streams instead of running as a workflow.',
    steps: [
      { actor: 'Browser', title: 'You open the chat', detail: 'The browser connects to the agent and asks for this chat’s child.' },
      { actor: 'Agent', title: 'It checks access', detail: 'The agent confirms you are allowed before handing over the child.' },
      { actor: 'Child', title: 'The prompt is assembled', detail: 'Base instructions, the agent’s own, the workspace, and your skills get stitched together.' },
      { actor: 'Child', title: 'The reply streams', detail: 'Words stream back as the model writes, and tools run inline.' },
      { actor: 'Database', title: 'The basics get saved', detail: 'Title and last message go to the database; the live conversation stays in the child.' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Running code & tools
// ---------------------------------------------------------------------------
export const execution = {
  intro: 'There are two ways for an agent to run code, and they are kept separate on purpose.',
  lanes: [
    {
      id: 'codemode',
      name: 'codemode',
      via: 'quick JavaScript',
      body: 'The model writes a small script that calls several tools at once, run in a locked-down sandbox. Good for stitching tool calls together.',
    },
    {
      id: 'sandbox',
      name: 'the container',
      via: 'a real Linux box',
      body: 'A full container with a filesystem for shell commands and real programs. Good for anything that needs an actual OS.',
    },
  ],
  seam: 'These two do not share files yet. The script world and the container’s /workspace are separate until we build a bridge between them. Worth knowing on day one so it does not surprise you.',
}

// ---------------------------------------------------------------------------
// Outside apps & permissions
// ---------------------------------------------------------------------------
export const connectors = {
  intro:
    'Gmail, GitHub, Drive, and search reach the agent as tools, handed over through a proxy using the MCP standard. Each tool carries a permission level that decides whether the agent just does it or stops to ask.',
  trustIntro: 'Three levels, set per connector:',
  trust: [
    { id: 'auto', name: 'auto', body: 'Go ahead without asking. For safe, high-volume things you trust.' },
    { id: 'allow', name: 'allow', body: 'Fine to read on its own, but check before it writes or sends.' },
    { id: 'ask', name: 'ask', body: 'Ask first, every time. The request shows up in your inbox.' },
  ],
  note: 'The levels are auto, allow, and ask. (Older docs use other names; those are gone.)',
}

// ---------------------------------------------------------------------------
// What the agent knows (prompt + skills)
// ---------------------------------------------------------------------------
export const prompt = {
  intro:
    'Every turn, the agent’s instructions get built up in layers. Skills are reusable instructions that live as files: write a good one once and every agent in the workspace can use it.',
  layers: [
    { id: 'foundation', name: 'Base', body: 'The ground rules every Garden agent shares.' },
    { id: 'agent', name: 'This agent', body: 'Its name, role, and personal instructions.' },
    { id: 'workspace', name: 'Workspace', body: 'The company’s name and context.' },
    { id: 'skills', name: 'Skills', body: 'Whichever reusable skills are turned on, loaded from storage.' },
  ],
}

// ---------------------------------------------------------------------------
// Standing on the AI SDK
// ---------------------------------------------------------------------------
export const ecosystem = {
  intro:
    'Think is built on the Vercel AI SDK, the most widely used toolkit for talking to language models. So we get its whole ecosystem for free and spend our time on the product instead of the plumbing.',
  gets: [
    { id: 'providers', name: 'Any model', body: 'Anthropic, OpenAI, and others behind one interface. Switching models is a config change, not a rewrite.' },
    { id: 'tools', name: 'Tool calling', body: 'Typed tools, structured output, and the call loop are handled for us.' },
    { id: 'streaming', name: 'Streaming', body: 'Words stream from the model all the way to the browser.' },
    { id: 'mcp', name: 'Tools & code', body: 'Connector tooling and code execution come with the runtime.' },
  ],
  evidence: 'In the code: Think depends on the AI SDK (ai v6) plus the Anthropic, OpenAI, and React adapters.',
}

// ---------------------------------------------------------------------------
// Why not just a script?
// ---------------------------------------------------------------------------
export const contrast = {
  intro:
    'The tempting shortcut is to grab a small open-source agent harness, or write your own loop against a model API, and ship it. Pi is a good, honest example. It works great for one developer at a terminal. It is the wrong shape for a product, and matching the product means rebuilding everything underneath.',
  piIntro:
    'Pi is an open-source coding agent: a model API, a loop, tool calling, a terminal UI, and a deliberately tiny core you extend yourself. Its own README is upfront about what it leaves out. It runs on your machine, for you, and forgets everything when you close it.',
  rows: [
    { capability: 'Where it runs', garden: 'On servers, reachable by name', bare: 'On your laptop, with your login' },
    { capability: 'Memory', garden: 'A database plus per-agent storage', bare: 'Nothing saved between sessions' },
    { capability: 'After a crash', garden: 'Resumes from the last step', bare: 'Gone with the process' },
    { capability: 'Many users', garden: 'One isolated instance per agent and run', bare: 'One process, no separation' },
    { capability: 'Permissions', garden: 'Per-tool levels, asks when it should', bare: 'No permission system' },
    { capability: 'Running code', garden: 'Managed sandbox and container', bare: 'Runs on your box; you secure it' },
    { capability: 'Shipping it', garden: 'One deploy, scales to zero', bare: 'No deployment story' },
  ],
  close:
    'Pi is not wrong. It is built for a different job. The point is that “just wrap a model in a loop” quietly signs you up to rebuild crash recovery, isolation, permissions, and sandboxing yourself. We let Cloudflare own those so the agent is the thing we work on.',
}

export const sources = [
  'docs/core/technical.md',
  'docs/core/project-think-cloudflare.md',
  'docs/core/chat-runtime-model.md',
  'github.com/earendil-works/pi',
]
