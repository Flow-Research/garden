import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { availableParallelism } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client, Pool } from 'pg'
import { getServerEnv } from '@garden/env'

const CANDIDATE_INDEX = 'issue_workspace_updated_order_idx'
const DEFAULT_REPETITIONS = 7
const DEFAULT_CONCURRENCY = 4
const BOOTSTRAP_SAMPLES = 20_000
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle',
)
const OUTPUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../.audit/db-load-test',
)

const SCALE_VALUES = [10, 100, 1000] as const
type Scale = (typeof SCALE_VALUES)[number]

type Options = {
  scales: Scale[]
  repetitions: number
  concurrency: number
  outputDir: string
  keepDatabases: boolean
}

type DatabasePairState = {
  names: string[]
}

type FixtureIds = {
  workspaceId: string
  userId: string
  agentId: string
  issueId: string
  automationId: string
  skillId: string
}

type FixtureCounts = {
  users: number
  agents: number
  teams: number
  issues: number
  commentsPerIssue: number
  runsPerIssue: number
  eventsPerRun: number
  threads: number
  automations: number
  automationRunsPerAutomation: number
  skills: number
  filesPerSkill: number
  documents: number
  inboxItemsPerIssue: number
  auditRowsPerAgent: number
}

type QueryOutput = unknown[][]

type QueryScenario = {
  id: string
  label: string
  description: string
  run: (pool: Pool, ids: FixtureIds) => Promise<QueryOutput>
  profile?: (ids: FixtureIds) => ProfileQuery
}

type ProfileQuery = {
  sql: string
  params: readonly unknown[]
}

type TimedSample = {
  durationMs: number
  rowCount: number
  checksum: string
  error: string | null
}

type ScenarioMeasurement = {
  scale: Scale
  scenarioId: string
  label: string
  description: string
  repetitions: number
  concurrency: number
  before: TimedSample[]
  after: TimedSample[]
  errors: number
  statistics: Statistics
  beforeProfile: PlanSummary | null
  afterProfile: PlanSummary | null
}

type Statistics = {
  beforeMedianMs: number
  afterMedianMs: number
  beforeP95Ms: number
  afterP95Ms: number
  beforeRangeMs: [number, number]
  afterRangeMs: [number, number]
  changePercent: number
  speedup: number
  meanDifferenceMs: number
  confidenceIntervalMs: [number, number]
  signFlipPValue: number
  verdict: 'faster' | 'slower' | 'no measurable difference' | 'inconclusive'
}

type PlanSummary = {
  planningMs: number
  executionMs: number
  nodeType: string
  indexName: string | null
  sortMethod: string | null
  sharedHitBlocks: number
  sharedReadBlocks: number
}

type BenchmarkReport = {
  generatedAt: string
  database: {
    postgresVersion: string
    candidateIndex: string
    baseline: string
    treatment: string
  }
  method: {
    scales: Scale[]
    repetitions: number
    concurrency: number
    warmupRuns: number
    confidenceLevel: number
    significanceLevel: number
    hostLoad: string
    cpuCount: number
  }
  measurements: ScenarioMeasurement[]
}

type FixturePair = {
  beforePool: Pool
  afterPool: Pool
  ids: FixtureIds
  counts: FixtureCounts
  close: () => Promise<void>
}

/**
 * Parse the load-test flags so every run uses explicit, bounded parameters.
 * The harness previously had no repeatable scale or sample contract because
 * no load tool existed. The flags now define the dimensions recorded in the
 * report and keep a local run from silently expanding beyond the requested
 * workload.
 */
function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? ''
    if (arg === '--') continue
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const key = rawKey ?? ''
    const next = inlineValue ?? argv[index + 1]
    if (inlineValue === undefined) index += 1
    values.set(key, next ?? '')
  }

  const requestedScales = (values.get('scales') ?? values.get('scale') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const scales =
    requestedScales.length === 0
      ? [...SCALE_VALUES]
      : requestedScales.map((value) => parseScale(value))
  const repetitions = parsePositiveInteger(
    values.get('repetitions'),
    DEFAULT_REPETITIONS,
  )
  const concurrency = parsePositiveInteger(
    values.get('concurrency'),
    DEFAULT_CONCURRENCY,
  )
  const outputDir = resolve(values.get('output') || OUTPUT_DIR)

  return {
    scales,
    repetitions,
    concurrency,
    outputDir,
    keepDatabases: values.get('keep-databases') === 'true',
  }
}

/**
 * Parse one supported scale multiplier and reject arbitrary values.
 * The benchmark compares the three requested relationship dimensions, so a
 * typo must fail before it creates a database or writes a report.
 */
function parseScale(value: string): Scale {
  const parsed = Number(value)
  if (SCALE_VALUES.includes(parsed as Scale)) return parsed as Scale
  throw new Error(`Unsupported scale ${value}. Use 10, 100, or 1000.`)
}

/**
 * Parse a positive integer flag with a safe default.
 * A zero or fractional repetition count would invalidate the statistical
 * summary, so the harness refuses it instead of producing an empty verdict.
 */
function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  throw new Error(`Expected a positive integer, received ${value}.`)
}

/**
 * Build deterministic UUIDs for fixture relationships.
 * Random fixture ids made before and after databases hard to compare because
 * a changed result could be an id mismatch rather than a query difference.
 */
function fixtureUuid(scope: string, index?: number): string {
  const seed = index === undefined ? `load:${scope}` : `load:${scope}:${index}`
  const hex = createHash('md5').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Return the ids shared by the before and after database copies.
 * The query suite uses these ids as stable relationship anchors for issue
 * timelines, automation runs, chat threads, and assigned skills.
 */
function fixtureIds(): FixtureIds {
  return {
    workspaceId: fixtureUuid('workspace'),
    userId: fixtureUuid('user', 1),
    agentId: fixtureUuid('agent', 1),
    issueId: fixtureUuid('issue', 1),
    automationId: fixtureUuid('automation', 1),
    skillId: fixtureUuid('skill', 1),
  }
}

/**
 * Scale the base fixture while keeping relationship fan-out realistic.
 * The 1000x case has 100,000 issues, 400,000 comments, 300,000 runs, and
 * 1,200,000 run events. These counts expose table scans and sort work without
 * making the harness depend on the user's existing data volume.
 */
function fixtureCounts(scale: Scale): FixtureCounts {
  return {
    users: 10 * scale,
    agents: 4 * scale,
    teams: 2 * scale,
    issues: 100 * scale,
    commentsPerIssue: 4,
    runsPerIssue: 3,
    eventsPerRun: 4,
    threads: 20 * scale,
    automations: 10 * scale,
    automationRunsPerAutomation: 4,
    skills: 5 * scale,
    filesPerSkill: 3,
    documents: 5 * scale,
    inboxItemsPerIssue: 2,
    auditRowsPerAgent: 10,
  }
}

/**
 * Quote a generated database identifier for PostgreSQL.
 * Temporary names contain only timestamp and scale characters, but quoting
 * keeps the DDL safe if a future caller changes the naming scheme.
 */
function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Create a connection URL for one temporary database on the local server.
 * The configured Garden database remains the admin connection only and never
 * receives fixture rows.
 */
function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

/**
 * Create a temporary PostgreSQL database or a clone of a seeded source.
 * Cloning after seeding gives baseline and treatment copies identical rows and
 * statistics while avoiding a second multi-million-row insert pass.
 */
async function createDatabase(
  adminUrl: string,
  name: string,
  template?: string,
): Promise<void> {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  const templateClause = template
    ? ` TEMPLATE ${quoteIdentifier(template)}`
    : ''
  await client.query(
    `CREATE DATABASE ${quoteIdentifier(name)}${templateClause}`,
  )
  await client.end()
}

/**
 * Drop one temporary database after the report is written.
 * PostgreSQL 16 supports `WITH (FORCE)`, which also handles a forgotten idle
 * benchmark connection without touching any database outside the generated
 * name list.
 */
async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  await client.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`,
  )
  await client.end()
}

/**
 * Create a benchmark pool with an error listener for forced cleanup.
 * PostgreSQL emits `57P01` on idle clients when a temporary database is
 * dropped. The old harness let that event escape as an unhandled error after a
 * failed run, which hid the original sample failure.
 */
function createBenchmarkPool(url: string, max: number): Pool {
  const pool = new Pool({ connectionString: url, max })
  pool.on('error', (cause: unknown) => {
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? String(cause.code)
        : ''
    if (code !== '57P01') {
      process.stderr.write(`benchmark pool error: ${errorMessage(cause)}\n`)
    }
  })
  return pool
}

/**
 * Apply the checked-in Drizzle migrations to a temporary database.
 * This makes the load suite exercise the same schema that Garden deploys and
 * keeps benchmark setup independent of a developer's current database state.
 */
async function migrateDatabase(url: string): Promise<void> {
  const pool = createBenchmarkPool(url, 4)
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR })
  await pool.end()
}

/**
 * Seed one relationship-rich Garden fixture with SQL set generators.
 * The application writes these tables through Drizzle, but PostgreSQL set
 * inserts let the benchmark reach the requested 1000x dimension in minutes
 * and keep all foreign-key relationships real.
 */
async function seedDatabase(
  url: string,
  scale: Scale,
): Promise<{ ids: FixtureIds; counts: FixtureCounts }> {
  const pool = createBenchmarkPool(url, 8)
  const ids = fixtureIds()
  const counts = fixtureCounts(scale)

  await pool.query(
    `insert into organization (id, name, slug, issue_prefix, settings)
     values ($1, 'Load test workspace', $2, 'LOAD', '{}'::jsonb)`,
    [ids.workspaceId, `load-test-${scale}`],
  )
  await pool.query(
    `insert into "user" (id, email, name)
     select md5('load:user:' || n::text)::uuid,
            'load-user-' || n::text || '@example.com',
            'Load user ' || n::text
     from generate_series(1, $1::int) as values(n)`,
    [counts.users],
  )
  await pool.query(
    `insert into member (id, organization_id, user_id, role)
     select md5('load:member:' || n::text)::uuid,
            $1::uuid,
            md5('load:user:' || n::text)::uuid,
            case when n = 1 then 'owner' else 'member' end
     from generate_series(1, $2::int) as values(n)`,
    [ids.workspaceId, counts.users],
  )
  await pool.query(
    `insert into agent (
       id, workspace_id, owner_user_id, name, role_title, is_default,
       status, host_name
     )
     select md5('load:agent:' || n::text)::uuid,
            $1::uuid,
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            'Load agent ' || n::text,
            'Load test agent',
            n = 1,
            'active',
            md5('load:agent-host:' || n::text)::text
     from generate_series(1, $3::int) as values(n)`,
    [ids.workspaceId, counts.users, counts.agents],
  )
  await pool.query(
    `insert into team (
       id, workspace_id, name, owner_user_id, created_by
     )
     select md5('load:team:' || n::text)::uuid,
            $1::uuid,
            'Load team ' || n::text,
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid
     from generate_series(1, $3::int) as values(n)`,
    [ids.workspaceId, counts.users, counts.teams],
  )
  await pool.query(
    `insert into team_member (
       id, team_id, workspace_id, user_id, created_by
     )
     select md5('load:team-member-user:' || n::text)::uuid,
            md5('load:team:' || n::text)::uuid,
            $1::uuid,
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid
     from generate_series(1, $3::int) as values(n)`,
    [ids.workspaceId, counts.users, counts.teams],
  )
  await pool.query(
    `insert into team_member (
       id, team_id, workspace_id, agent_id, created_by
     )
     select md5('load:team-member-agent:' || n::text)::uuid,
            md5('load:team:' || n::text)::uuid,
            $1::uuid,
            md5('load:agent:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            md5('load:user:' || (1 + mod(n - 1, $3::int))::text)::uuid
     from generate_series(1, $4::int) as values(n)`,
    [ids.workspaceId, counts.agents, counts.users, counts.teams],
  )
  await pool.query(
    `insert into capability (
       id, connector_type, name, description, schema_hash, risk_class
     )
     select md5('load:capability:' || n::text)::uuid,
            'manual',
            'load_tool_' || n::text,
            'Load test capability',
            'load-test',
            case when mod(n, 3) = 0 then 'write' else 'read' end
     from generate_series(1, 8) as values(n)`,
  )
  await pool.query(
    `insert into issue (
       id, workspace_id, team_id, number, title, description, status,
       priority, assignee_type, assignee_id, position, created_by,
       created_at, updated_at
     )
     select md5('load:issue:' || n::text)::uuid,
            $1::uuid,
            md5('load:team:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            n,
            case when mod(n, 97) = 0
              then 'Needle issue ' || n::text
              else 'Load issue ' || n::text
            end,
            case when mod(n, 89) = 0
              then 'Needle description for issue ' || n::text
              else 'Description for load issue ' || n::text
            end,
            case mod(n, 11)
              when 0 then 'blocked'
              when 1 then 'done'
              when 2 then 'in_review'
              when 3 then 'in_progress'
              else 'todo'
            end,
            case mod(n, 5)
              when 0 then 'urgent'
              when 1 then 'high'
              when 2 then 'medium'
              when 3 then 'low'
              else 'none'
            end,
            'agent',
            md5('load:agent:' || (1 + mod(n - 1, $3::int))::text)::uuid,
            lpad(n::text, 12, '0'),
            md5('load:user:' || (1 + mod(n - 1, $4::int))::text)::uuid,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              (n::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              (n::text || ' seconds')::interval
     from generate_series(1, $5::int) as values(n)`,
    [ids.workspaceId, counts.teams, counts.agents, counts.users, counts.issues],
  )
  await pool.query(
    `insert into issue_comment (
       id, issue_id, author_type, author_id, body, mentions, created_at
     )
     select md5('load:comment:' || i::text || ':' || c::text)::uuid,
            md5('load:issue:' || i::text)::uuid,
            case when mod(c, 2) = 0 then 'user' else 'agent' end,
            case when mod(c, 2) = 0
              then md5('load:user:' || (1 + mod(i + c - 2, $1::int))::text)::uuid
              else md5('load:agent:' || (1 + mod(i + c - 2, $2::int))::text)::uuid
            end,
            case when mod(i, 101) = 0
              then 'Needle comment on issue ' || i::text
              else 'Comment ' || c::text || ' on issue ' || i::text
            end,
            case when c = 1
              then jsonb_build_object('users', jsonb_build_array(md5('load:user:1')::text))
              else jsonb_build_object('users', jsonb_build_array())
            end,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i * 10 + c)::text || ' seconds')::interval
     from generate_series(1, $3::int) as issues(i)
     cross join generate_series(1, $4::int) as comments(c)`,
    [counts.users, counts.agents, counts.issues, counts.commentsPerIssue],
  )
  await pool.query(
    `insert into issue_attachment (
       id, workspace_id, issue_id, comment_id, uploader_type, uploader_id,
       filename, r2_key, content_type, size_bytes
     )
     select md5('load:attachment:' || i::text || ':' || c::text)::uuid,
            $1::uuid,
            md5('load:issue:' || i::text)::uuid,
            md5('load:comment:' || i::text || ':' || c::text)::uuid,
            'member',
            md5('load:user:' || (1 + mod(i - 1, $2::int))::text)::uuid,
            'attachment-' || i::text || '-' || c::text || '.txt',
            'load-test/' || i::text || '/' || c::text,
            'text/plain',
            1024
     from generate_series(1, $3::int) as issues(i)
     cross join generate_series(1, $4::int) as comments(c)
     where mod(i + c, 4) = 0`,
    [ids.workspaceId, counts.users, counts.issues, counts.commentsPerIssue],
  )
  await pool.query(
    `insert into issue_run (
       id, workspace_id, issue_id, agent_id, host_name, status,
       trigger_source, created_at, updated_at, started_at, finished_at
     )
     select md5('load:issue-run:' || i::text || ':' || r::text)::uuid,
            $1::uuid,
            md5('load:issue:' || i::text)::uuid,
            md5('load:agent:' || (1 + mod(i + r - 2, $2::int))::text)::uuid,
            md5('load:agent-host:' || (1 + mod(i + r - 2, $2::int))::text)::text,
            case mod(r, 3) when 0 then 'running' when 1 then 'succeeded' else 'failed' end,
            'manual',
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i * 20 + r)::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i * 20 + r)::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i * 20 + r)::text || ' seconds')::interval,
            case when mod(r, 3) = 0 then null
              else timestamp with time zone '2026-01-01 00:00:00+00' -
                ((i * 20 + r - 1)::text || ' seconds')::interval
            end
     from generate_series(1, $3::int) as issues(i)
     cross join generate_series(1, $4::int) as runs(r)`,
    [ids.workspaceId, counts.agents, counts.issues, counts.runsPerIssue],
  )
  await pool.query(
    `insert into issue_run_event (
       id, workspace_id, issue_id, run_id, seq, event_type, stream, level,
       message, payload, created_at
     )
     select md5('load:issue-run-event:' || i::text || ':' || r::text || ':' || e::text)::uuid,
            $1::uuid,
            md5('load:issue:' || i::text)::uuid,
            md5('load:issue-run:' || i::text || ':' || r::text)::uuid,
            e,
            case when e = $2::int then 'issue_run:failed'
                 when e = $3::int then 'issue_run:succeeded'
                 when e = 2 then 'issue_run:tool_started'
                 else 'issue_run:started'
            end,
            case when e = 2 then 'tool' else 'system' end,
            case when e = $2::int then 'error' else 'info' end,
            'Load event ' || e::text,
            jsonb_build_object('tool', 'load_tool', 'message', 'load event'),
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i * 20 + r * 5 + e)::text || ' seconds')::interval
     from generate_series(1, $4::int) as issues(i)
     cross join generate_series(1, $5::int) as runs(r)
     cross join generate_series(1, $6::int) as events(e)`,
    [
      ids.workspaceId,
      counts.eventsPerRun - 1,
      counts.eventsPerRun,
      counts.issues,
      counts.runsPerIssue,
      counts.eventsPerRun,
    ],
  )
  await pool.query(
    `insert into issue_work_product (
       id, workspace_id, issue_id, run_id, agent_id, type, status,
       review_state, is_primary, title, body, payload
     )
     select md5('load:work-product:' || i::text)::uuid,
            $1::uuid,
            md5('load:issue:' || i::text)::uuid,
            md5('load:issue-run:' || i::text || ':1')::uuid,
            md5('load:agent:' || (1 + mod(i - 1, $2::int))::text)::uuid,
            'report',
            case when mod(i, 5) = 0 then 'review' else 'approved' end,
            case when mod(i, 5) = 0 then 'pending' else 'approved' end,
            true,
            'Load report ' || i::text,
            'Load report body for issue ' || i::text,
            jsonb_build_object('scale', $3::int)
     from generate_series(1, $4::int) as issues(i)`,
    [ids.workspaceId, counts.agents, scale, counts.issues],
  )

  await seedSecondaryRelationships(pool, ids, counts)
  await pool.query('ANALYZE')
  await pool.end()
  return { ids, counts }
}

/**
 * Seed the secondary tables that real list and access paths join.
 * These rows make the suite cover chat, Inbox, automation, skills, documents,
 * permissions, and audit relationships instead of treating `issue` as an
 * isolated synthetic table.
 */
async function seedSecondaryRelationships(
  pool: Pool,
  ids: FixtureIds,
  counts: FixtureCounts,
): Promise<void> {
  await pool.query(
    `insert into chat_thread (
       id, workspace_id, owner_user_id, agent_id, primary_issue_id,
       runtime_kind, runtime_key, title, last_message, created_at, updated_at
     )
     select md5('load:thread:' || n::text)::uuid,
            $1::uuid,
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            md5('load:agent:' || (1 + mod(n - 1, $3::int))::text)::uuid,
            md5('load:issue:' || (1 + mod(n - 1, $4::int))::text)::uuid,
            'chat',
            md5('load:thread-key:' || n::text)::uuid,
            'Load thread ' || n::text,
            'Load message',
            timestamp with time zone '2026-01-01 00:00:00+00' -
              (n::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              (n::text || ' seconds')::interval
     from generate_series(1, $5::int) as values(n)`,
    [
      ids.workspaceId,
      counts.users,
      counts.agents,
      counts.issues,
      counts.threads,
    ],
  )
  await pool.query(
    `insert into permission_grant (
       id, agent_id, capability_id, trust_level, granted_by
     )
     select md5('load:permission-grant:' || a::text || ':' || c::text)::uuid,
            md5('load:agent:' || a::text)::uuid,
            md5('load:capability:' || c::text)::uuid,
            case when mod(c, 3) = 0 then 'ask' else 'allow' end,
            md5('load:user:' || (1 + mod(a - 1, $1::int))::text)::uuid
     from generate_series(1, $2::int) as agents(a)
     cross join generate_series(1, 8) as capabilities(c)`,
    [counts.users, counts.agents],
  )
  await pool.query(
    `insert into permission_request (
       id, agent_id, kind, capability_id, context, issue_id, run_id,
       requested_at, status
     )
     select md5('load:permission-request:' || a::text || ':' || n::text)::uuid,
            md5('load:agent:' || a::text)::uuid,
            'connector_write',
            md5('load:capability:' || (1 + mod(a + n - 2, 8))::text)::uuid,
            'Load approval request',
            md5('load:issue:' || (1 + mod(a + n - 2, $1::int))::text)::uuid,
            md5('load:issue-run:' || (1 + mod(a + n - 2, $1::int))::text || ':1')::uuid,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((a + n)::text || ' seconds')::interval,
            'pending'
     from generate_series(1, $2::int) as agents(a)
     cross join generate_series(1, 2) as requests(n)`,
    [counts.issues, counts.agents],
  )
  await pool.query(
    `insert into inbox_item (
       id, workspace_id, recipient_type, recipient_id, item_key, actor_type,
       actor_id, type, severity, issue_id, issue_status, title, body, details,
       activity_at, created_at, updated_at
     )
     select md5('load:inbox:' || i::text || ':' || n::text)::uuid,
            $1::uuid,
            'member',
            md5('load:user:1')::uuid,
            'load:issue:' || i::text || ':item:' || n::text,
            'agent',
            md5('load:agent:' || (1 + mod(i - 1, $2::int))::text)::uuid,
            'new_comment',
            case when n = 1 then 'action_required' else 'attention' end,
            md5('load:issue:' || i::text)::uuid,
            case mod(i, 11) when 0 then 'blocked' when 1 then 'done' else 'todo' end,
            'Load inbox item ' || i::text || ':' || n::text,
            'Load inbox body',
            jsonb_build_object('issue_number', i, 'comment_id', n),
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i + n)::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i + n)::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((i + n)::text || ' seconds')::interval
     from generate_series(1, $3::int) as issues(i)
     cross join generate_series(1, $4::int) as items(n)`,
    [ids.workspaceId, counts.agents, counts.issues, counts.inboxItemsPerIssue],
  )
  await pool.query(
    `insert into automation (
       id, workspace_id, title, assignee_agent_id, status,
       concurrency_policy, created_by, system_prompt, input_schema,
       output_config, execution_config, notification_config, scheduling_config,
       tags, run_count, success_count, failure_count, skip_count
     )
     select md5('load:automation:' || n::text)::uuid,
            $1::uuid,
            'Load automation ' || n::text,
            md5('load:agent:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            'active',
            'skip',
            md5('load:user:' || (1 + mod(n - 1, $3::int))::text)::uuid,
            'Load automation prompt',
            '{}'::jsonb,
            '{}'::jsonb,
            '{}'::jsonb,
            '{}'::jsonb,
            '{}'::jsonb,
            ARRAY['load'],
            $4::int,
            $4::int,
            0,
            0
     from generate_series(1, $5::int) as values(n)`,
    [
      ids.workspaceId,
      counts.agents,
      counts.users,
      counts.automationRunsPerAutomation,
      counts.automations,
    ],
  )
  await pool.query(
    `insert into automation_trigger (
       id, automation_id, kind, enabled, label, cron_expression, timezone
     )
     select md5('load:automation-trigger:' || n::text)::uuid,
            md5('load:automation:' || n::text)::uuid,
            'schedule',
            true,
            'Load schedule',
            '*/5 * * * *',
            'UTC'
     from generate_series(1, $1::int) as values(n)`,
    [counts.automations],
  )
  await pool.query(
    `insert into automation_run (
       id, workspace_id, automation_id, trigger_id, source, status, agent_id,
       host_name, result_json, triggered_at, completed_at, created_at, updated_at
     )
     select md5('load:automation-run:' || a::text || ':' || r::text)::uuid,
            $1::uuid,
            md5('load:automation:' || a::text)::uuid,
            md5('load:automation-trigger:' || a::text)::uuid,
            'schedule',
            case when mod(r, 4) = 0 then 'failed' else 'completed' end,
            md5('load:agent:' || (1 + mod(a - 1, $2::int))::text)::uuid,
            md5('load:agent-host:' || (1 + mod(a - 1, $2::int))::text)::text,
            jsonb_build_object('scale', $3::int),
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((a * 10 + r)::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((a * 10 + r - 1)::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((a * 10 + r)::text || ' seconds')::interval,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((a * 10 + r)::text || ' seconds')::interval
     from generate_series(1, $4::int) as automations(a)
     cross join generate_series(1, $5::int) as runs(r)`,
    [
      ids.workspaceId,
      counts.agents,
      Math.round(counts.automations / 10),
      counts.automations,
      counts.automationRunsPerAutomation,
    ],
  )
  await pool.query(
    `insert into skill (
       id, workspace_id, name, slug, description, frontmatter, body,
       source_type, bundle_hash, author_id
     )
     select md5('load:skill:' || n::text)::uuid,
            $1::uuid,
            'Load skill ' || n::text,
            'load-skill-' || n::text,
            'Load skill description',
            '{}',
            '# Load skill ' || n::text,
            'manual',
            'load-test',
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid
     from generate_series(1, $3::int) as values(n)`,
    [ids.workspaceId, counts.users, counts.skills],
  )
  await pool.query(
    `insert into skill_file (id, skill_id, path, content_hash, r2_key)
     select md5('load:skill-file:' || s::text || ':' || f::text)::uuid,
            md5('load:skill:' || s::text)::uuid,
            'references/file-' || f::text || '.md',
            'load-test',
            'load-test/' || s::text || '/' || f::text
     from generate_series(1, $1::int) as skills(s)
     cross join generate_series(1, $2::int) as files(f)`,
    [counts.skills, counts.filesPerSkill],
  )
  await pool.query(
    `insert into skill_assignment (
       workspace_id, target_kind, target_id, skill_id, enabled
     )
     select $1::uuid,
            'agent',
            md5('load:agent:' || (1 + mod(s - 1, $2::int))::text)::uuid,
            md5('load:skill:' || s::text)::uuid,
            true
     from generate_series(1, $3::int) as skills(s)`,
    [ids.workspaceId, counts.agents, counts.skills],
  )
  await pool.query(
    `insert into document (
       id, workspace_id, owner_user_id, thread_id, filename, file_type,
       size_bytes, page_count, status
     )
     select md5('load:document:' || n::text)::uuid,
            $1::uuid,
            md5('load:user:' || (1 + mod(n - 1, $2::int))::text)::uuid,
            md5('load:thread:' || (1 + mod(n - 1, $3::int))::text)::uuid,
            'load-document-' || n::text || '.md',
            'md',
            2048,
            1,
            'ready'
     from generate_series(1, $4::int) as values(n)`,
    [ids.workspaceId, counts.users, counts.threads, counts.documents],
  )
  await pool.query(
    `insert into document_version (
       id, document_id, storage_path, source, version_number, display_name
     )
     select md5('load:document-version:' || d::text || ':' || v::text)::uuid,
            md5('load:document:' || d::text)::uuid,
            'load-test/' || d::text || '/' || v::text,
            'generated',
            v,
            'Load document version ' || v::text
     from generate_series(1, $1::int) as documents(d)
     cross join generate_series(1, 3) as versions(v)`,
    [counts.documents],
  )
  await pool.query(
    `update document
     set current_version_id = versions.id
     from document_version as versions
     where versions.document_id = document.id
       and versions.version_number = 3`,
  )
  await pool.query(
    `insert into activity_event (
       id, workspace_id, subject_type, subject_id, actor_type, actor_id,
       event_type, payload, created_at
     )
     select md5('load:activity:' || a::text || ':' || n::text)::uuid,
            $1::uuid,
            'agent',
            md5('load:agent:' || a::text)::uuid,
            'member',
            md5('load:user:' || (1 + mod(a - 1, $2::int))::text)::uuid,
            'grant_changed',
            jsonb_build_object('scope', 'agent', 'connector_id', 'manual'),
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((a * 10 + n)::text || ' seconds')::interval
     from generate_series(1, $3::int) as agents(a)
     cross join generate_series(1, $4::int) as events(n)`,
    [ids.workspaceId, counts.users, counts.agents, counts.auditRowsPerAgent],
  )
  await pool.query(
    `insert into tool_call_audit (
       id, workspace_id, agent_id, capability_id, tool_call_id, args_hash,
       result_status, duration_ms, ts, error
     )
     select md5('load:audit:' || a::text || ':' || n::text)::uuid,
            $1::uuid,
            md5('load:agent:' || a::text)::uuid,
            md5('load:capability:' || (1 + mod(a + n - 2, 8))::text)::uuid,
            'load-tool-call-' || a::text || '-' || n::text,
            'load-test',
            'success',
            12,
            timestamp with time zone '2026-01-01 00:00:00+00' -
              ((a * 10 + n)::text || ' seconds')::interval,
            null
     from generate_series(1, $2::int) as agents(a)
     cross join generate_series(1, $3::int) as events(n)`,
    [ids.workspaceId, counts.agents, counts.auditRowsPerAgent],
  )
}

/**
 * Return the route-shaped query workload used by every scale.
 * Each scenario follows a current Garden route or server helper so a timing
 * result points to a product query that can regress, not to a benchmark-only
 * statement.
 */
function queryScenarios(): QueryScenario[] {
  return [
    {
      id: 'issues:list',
      label: 'Issue list',
      description:
        'Count and page workspace issues in the order used by GET /api/issues.',
      run: async (pool, ids) => {
        const count = await pool.query(
          `select count(*)::int as count
           from issue
           where workspace_id = $1`,
          [ids.workspaceId],
        )
        const page = await pool.query(
          `select id, number, title, status, priority, updated_at, created_at
           from issue
           where workspace_id = $1
           order by updated_at desc, created_at desc, number desc
           limit 50 offset 250`,
          [ids.workspaceId],
        )
        return [count.rows, page.rows]
      },
      profile: (ids) => ({
        sql: `select id, number, title, status, priority, updated_at, created_at
              from issue
              where workspace_id = $1
              order by updated_at desc, created_at desc, number desc
              limit 50 offset 250`,
        params: [ids.workspaceId],
      }),
    },
    {
      id: 'issues:search',
      label: 'Issue search',
      description:
        'Search issue text and comment text as GET /api/issues/search does.',
      run: async (pool, ids) => {
        const commentMatches = await pool.query(
          `select issue_comment.issue_id
           from issue_comment
           inner join issue on issue.id = issue_comment.issue_id
           where issue.workspace_id = $1
             and issue_comment.body ilike $2`,
          [ids.workspaceId, '%needle%'],
        )
        const issueMatches = await pool.query(
          `select id, number, title, description, updated_at, created_at
           from issue
           where workspace_id = $1
             and (title ilike $2 or description ilike $2)
           order by updated_at desc, created_at desc`,
          [ids.workspaceId, '%needle%'],
        )
        return [commentMatches.rows, issueMatches.rows]
      },
      profile: (ids) => ({
        sql: `select id, number, title, description, updated_at, created_at
              from issue
              where workspace_id = $1
                and (title ilike $2 or description ilike $2)
              order by updated_at desc, created_at desc`,
        params: [ids.workspaceId, '%needle%'],
      }),
    },
    {
      id: 'issues:timeline',
      label: 'Issue timeline',
      description:
        'Load comments, comment attachments, and run events for one issue.',
      run: async (pool, ids) => {
        const comments = await pool.query(
          `select *
           from issue_comment
           where issue_id = $1`,
          [ids.issueId],
        )
        const commentIds = comments.rows.map((row) => row.id as string)
        const attachments = commentIds.length
          ? await pool.query(
              `select *
               from issue_attachment
               where comment_id = any($1::uuid[])
               order by created_at asc`,
              [commentIds],
            )
          : { rows: [] }
        const events = await pool.query(
          `select issue_run_event.*, issue_run.agent_id
           from issue_run_event
           inner join issue_run on issue_run.id = issue_run_event.run_id
           where issue_run_event.issue_id = $1`,
          [ids.issueId],
        )
        return [comments.rows, attachments.rows, events.rows]
      },
      profile: (ids) => ({
        sql: `select issue_run_event.*, issue_run.agent_id
              from issue_run_event
              inner join issue_run on issue_run.id = issue_run_event.run_id
              where issue_run_event.issue_id = $1`,
        params: [ids.issueId],
      }),
    },
    {
      id: 'inbox:source',
      label: 'Inbox source queries',
      description:
        'Load the workspace-wide issue, comment, approval, work-product, and run sources used by the Inbox.',
      run: async (pool, ids) => {
        const mention = JSON.stringify({ users: [ids.userId] })
        const [
          issues,
          comments,
          approvals,
          workProducts,
          failedRuns,
          goodRuns,
        ] = await Promise.all([
          pool.query(`select * from issue where workspace_id = $1`, [
            ids.workspaceId,
          ]),
          pool.query(
            `select issue_comment.id, issue_comment.issue_id,
                      issue_comment.author_type, issue_comment.author_id,
                      issue_comment.body, issue_comment.mentions,
                      issue_comment.created_at
               from issue_comment
               inner join issue on issue.id = issue_comment.issue_id
               where issue.workspace_id = $1
                 and (issue_comment.author_type = 'agent'
                   or (issue_comment.author_type = 'user'
                       and issue_comment.author_id <> $2))
                 and (issue_comment.mentions @> $3::jsonb
                   or issue.created_by = $2
                   or (issue.assignee_type = 'user' and issue.assignee_id = $2))
               order by issue_comment.created_at desc
               limit 300`,
            [ids.workspaceId, ids.userId, mention],
          ),
          pool.query(
            `select permission_request.*
               from permission_request
               inner join agent on agent.id = permission_request.agent_id
               where permission_request.kind = 'connector_write'
                 and permission_request.status = 'pending'
                 and agent.workspace_id = $1
               order by permission_request.requested_at desc
               limit 50`,
            [ids.workspaceId],
          ),
          pool.query(
            `select * from issue_work_product
               where workspace_id = $1
                 and status = 'review'
                 and review_state = 'pending'
               order by updated_at desc
               limit 100`,
            [ids.workspaceId],
          ),
          pool.query(
            `select * from issue_run
               where workspace_id = $1 and status = 'failed'
               order by finished_at desc
               limit 100`,
            [ids.workspaceId],
          ),
          pool.query(
            `select * from issue_run
               where workspace_id = $1 and status = 'succeeded'
               order by finished_at desc
               limit 100`,
            [ids.workspaceId],
          ),
        ])
        return [
          issues.rows,
          comments.rows,
          approvals.rows,
          workProducts.rows,
          failedRuns.rows,
          goodRuns.rows,
        ]
      },
      profile: (ids) => ({
        sql: `select * from issue where workspace_id = $1`,
        params: [ids.workspaceId],
      }),
    },
    {
      id: 'agents:activity',
      label: 'Agent activity',
      description: 'Load the two feeds merged by GET /api/agents/:id/activity.',
      run: async (pool, ids) => {
        const [decisions, changes] = await Promise.all([
          pool.query(
            `select tool_call_audit.id, tool_call_audit.tool_call_id,
                    capability.name, capability.connector_type,
                    tool_call_audit.result_status, tool_call_audit.error,
                    tool_call_audit.ts
             from tool_call_audit
             inner join capability on capability.id = tool_call_audit.capability_id
             where tool_call_audit.workspace_id = $1
               and tool_call_audit.agent_id = $2
             order by tool_call_audit.ts desc
             limit 50`,
            [ids.workspaceId, ids.agentId],
          ),
          pool.query(
            `select id, event_type, payload, created_at
             from activity_event
             where workspace_id = $1
               and subject_type = 'agent'
               and subject_id = $2
             order by created_at desc
             limit 50`,
            [ids.workspaceId, ids.agentId],
          ),
        ])
        return [decisions.rows, changes.rows]
      },
      profile: (ids) => ({
        sql: `select tool_call_audit.id, tool_call_audit.tool_call_id,
                     capability.name, capability.connector_type,
                     tool_call_audit.result_status, tool_call_audit.error,
                     tool_call_audit.ts
              from tool_call_audit
              inner join capability on capability.id = tool_call_audit.capability_id
              where tool_call_audit.workspace_id = $1
                and tool_call_audit.agent_id = $2
              order by tool_call_audit.ts desc
              limit 50`,
        params: [ids.workspaceId, ids.agentId],
      }),
    },
    {
      id: 'chat:list',
      label: 'Chat thread list',
      description:
        'Load owned, unarchived chat threads with their agents and primary issues.',
      run: async (pool, ids) => {
        const rows = await pool.query(
          `select chat_thread.*, agent.host_name,
                  issue.id as primary_issue_id,
                  issue.number as primary_issue_number,
                  issue.title as primary_issue_title,
                  issue.status as primary_issue_status
           from chat_thread
           inner join agent on agent.id = chat_thread.agent_id
           left join issue on issue.id = chat_thread.primary_issue_id
           where chat_thread.workspace_id = $1
             and chat_thread.owner_user_id = $2
             and chat_thread.archived_at is null
           order by chat_thread.updated_at desc`,
          [ids.workspaceId, ids.userId],
        )
        return [rows.rows]
      },
    },
    {
      id: 'automations:runs',
      label: 'Automation run history',
      description:
        'Load one automation history page through listAutomationRuns.',
      run: async (pool, ids) => {
        const rows = await pool.query(
          `select * from automation_run
           where automation_id = $1
           order by triggered_at desc
           limit 50 offset 0`,
          [ids.automationId],
        )
        return [rows.rows]
      },
    },
    {
      id: 'skills:assigned',
      label: 'Assigned skill catalog',
      description:
        'Load an agent skill catalog through the assignment and skill tables.',
      run: async (pool, ids) => {
        const rows = await pool.query(
          `select skill.*
           from skill_assignment
           inner join skill on skill.id = skill_assignment.skill_id
           where skill_assignment.workspace_id = $1
             and skill_assignment.target_kind = 'agent'
             and skill_assignment.target_id = $2
             and skill_assignment.enabled = true
           order by skill.name asc`,
          [ids.workspaceId, ids.agentId],
        )
        return [rows.rows]
      },
    },
  ]
}

/**
 * Convert query rows into an order-independent correctness witness.
 * The search route orders by non-unique timestamps, so PostgreSQL may return
 * the same rows in a different tie order when the candidate index changes.
 * The old edge-row witness treated that valid order change as a data error.
 * The new witness compares the full row multiset after the timer stops, while
 * preserving the boundary between separate result sets in one scenario.
 */
function summarizeOutput(output: QueryOutput): {
  rowCount: number
  checksum: string
} {
  const rowCount = output.reduce((total, rows) => total + rows.length, 0)
  const canonicalRows = output
    .flatMap((rows, resultIndex) =>
      rows.map((row) => `${resultIndex}:${stableSerialize(row)}`),
    )
    .sort()
  const checksum = createHash('sha256')
    .update(canonicalRows.join('\n'))
    .digest('hex')
    .slice(0, 16)
  return { rowCount, checksum }
}

/**
 * Serialize database values with stable object keys for result comparison.
 * This runs after each timed sample, so canonicalization cannot inflate the
 * latency number while still detecting changed rows and duplicate counts.
 */
function stableSerialize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
  return `{${entries.join(',')}}`
}

/**
 * Run one scenario at the requested connection concurrency.
 * The timer covers the database round trips and result transfer, while the
 * checksum runs after the timer so JSON hashing does not become the measured
 * query cost.
 */
function timeScenario(
  scenario: QueryScenario,
  pool: Pool,
  ids: FixtureIds,
  concurrency: number,
): Promise<TimedSample> {
  const startedAt = performance.now()
  return Promise.allSettled(
    Array.from({ length: concurrency }, () => scenario.run(pool, ids)),
  ).then((results) => {
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (rejected) {
      return {
        durationMs: performance.now() - startedAt,
        rowCount: 0,
        checksum: '',
        error: errorMessage(rejected.reason),
      }
    }
    const outputs = results.map(
      (result) => (result as PromiseFulfilledResult<QueryOutput>).value,
    )
    const durationMs = performance.now() - startedAt
    const summary = outputs.map(summarizeOutput).reduce(
      (total, current) => ({
        rowCount: total.rowCount + current.rowCount,
        checksum: current.checksum,
      }),
      { rowCount: 0, checksum: '' },
    )
    return {
      durationMs,
      rowCount: summary.rowCount,
      checksum: summary.checksum,
      error: summary.rowCount === 0 ? 'query returned no rows' : null,
    }
  })
}

/**
 * Convert an unknown rejected value into a stable report string.
 * Database drivers can reject with an Error or a plain object, and the report
 * must count both forms without hiding a failed sample behind a thrown script.
 */
function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

/**
 * Produce a deterministic pseudo-random bit for sample order.
 * Alternating before and after work reduces cache and host drift bias without
 * making a result impossible to reproduce from the saved report metadata.
 */
function sampleOrderBit(seed: number): boolean {
  const value = (seed * 1_103_515_245 + 12_345) % 2_147_483_647
  return value % 2 === 0
}

/**
 * Return a median for a non-empty set of durations.
 * The benchmark reports medians because one slow PostgreSQL sample must not
 * replace the typical query cost with an arithmetic average.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? Number.NaN
  const lower = sorted[middle - 1] ?? Number.NaN
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper
}

/**
 * Return the requested percentile using the nearest observed sample.
 * A p95 from seven samples is a descriptive upper sample value, not a claim
 * about a production tail larger than the experiment can observe.
 */
function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(fraction * sorted.length) - 1,
  )
  return sorted[index] ?? Number.NaN
}

/**
 * Calculate a paired bootstrap interval for after-minus-before latency.
 * Pairing keeps each before and after sample from the same round together and
 * answers whether the observed change survives resampling at 95% confidence.
 */
function bootstrapInterval(
  differences: readonly number[],
  seed: number,
): [number, number] {
  if (differences.length === 0) return [Number.NaN, Number.NaN]
  let state = seed || 1
  const means: number[] = []
  for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample += 1) {
    let sum = 0
    for (let index = 0; index < differences.length; index += 1) {
      state = (state * 48_271) % 2_147_483_647
      const choice = state % differences.length
      sum += differences[choice] ?? 0
    }
    means.push(sum / differences.length)
  }
  return [percentile(means, 0.025), percentile(means, 0.975)]
}

/**
 * Calculate an exact sign-flip p-value for small paired samples.
 * The null model keeps each absolute difference and randomizes only its sign,
 * which tests whether the direction of the change is stronger than round noise.
 */
function signFlipPValue(differences: readonly number[]): number {
  if (differences.length === 0) return Number.NaN
  const observed = Math.abs(
    differences.reduce((sum, value) => sum + value, 0) / differences.length,
  )
  if (differences.length <= 16) {
    const combinations = 2 ** differences.length
    let atLeastAsExtreme = 0
    for (let mask = 0; mask < combinations; mask += 1) {
      const signedMean =
        differences.reduce(
          (sum, value, index) =>
            sum + ((mask & (1 << index)) === 0 ? value : -value),
          0,
        ) / differences.length
      if (Math.abs(signedMean) >= observed) atLeastAsExtreme += 1
    }
    return atLeastAsExtreme / combinations
  }

  let state = 19_271
  let atLeastAsExtreme = 0
  for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample += 1) {
    let sum = 0
    for (const value of differences) {
      state = (state * 48_271) % 2_147_483_647
      sum += state % 2 === 0 ? value : -value
    }
    if (Math.abs(sum / differences.length) >= observed) atLeastAsExtreme += 1
  }
  return atLeastAsExtreme / BOOTSTRAP_SAMPLES
}

/**
 * Summarize paired before and after durations into a decision-ready result.
 * A result with an error, fewer than five valid pairs, or a confidence interval
 * that crosses zero stays inconclusive or neutral instead of claiming a fix.
 */
function calculateStatistics(
  before: readonly TimedSample[],
  after: readonly TimedSample[],
  errors: number,
): Statistics {
  const pairs = before.flatMap((sample, index) => {
    const treatment = after[index]
    if (!treatment || sample.error || treatment.error) return []
    return [{ before: sample.durationMs, after: treatment.durationMs }]
  })
  const beforeDurations = pairs.map((pair) => pair.before)
  const afterDurations = pairs.map((pair) => pair.after)
  const differences = pairs.map((pair) => pair.after - pair.before)
  const beforeMedianMs = median(beforeDurations)
  const afterMedianMs = median(afterDurations)
  const confidenceIntervalMs = bootstrapInterval(differences, pairs.length + 17)
  const signFlipP = signFlipPValue(differences)
  const hasSignificantChange =
    pairs.length >= 5 &&
    errors === 0 &&
    signFlipP < 0.05 &&
    (confidenceIntervalMs[0] > 0 || confidenceIntervalMs[1] < 0)
  const changePercent =
    Number.isFinite(beforeMedianMs) && beforeMedianMs > 0
      ? ((afterMedianMs - beforeMedianMs) / beforeMedianMs) * 100
      : Number.NaN
  const verdict =
    errors > 0 || pairs.length < 5
      ? 'inconclusive'
      : !hasSignificantChange
        ? 'no measurable difference'
        : afterMedianMs < beforeMedianMs
          ? 'faster'
          : 'slower'

  return {
    beforeMedianMs,
    afterMedianMs,
    beforeP95Ms: percentile(beforeDurations, 0.95),
    afterP95Ms: percentile(afterDurations, 0.95),
    beforeRangeMs: [Math.min(...beforeDurations), Math.max(...beforeDurations)],
    afterRangeMs: [Math.min(...afterDurations), Math.max(...afterDurations)],
    changePercent,
    speedup: beforeMedianMs / afterMedianMs,
    meanDifferenceMs:
      differences.reduce((sum, value) => sum + value, 0) /
      Math.max(differences.length, 1),
    confidenceIntervalMs,
    signFlipPValue: signFlipP,
    verdict,
  }
}

/**
 * Read a PostgreSQL EXPLAIN JSON value as a plain object.
 * The driver returns JSON payloads as unknown to this harness, so the parser
 * checks each boundary before extracting plan fields.
 */
function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * Find one plan property through nested PostgreSQL plan nodes.
 * A query can move from a sequential scan to an index scan or a sort child,
 * so a root-only lookup would miss the evidence that explains the timing.
 */
function findPlanProperty(
  plan: Record<string, unknown>,
  property: string,
): unknown {
  if (property in plan) return plan[property]
  const nestedPlan = recordValue(plan.Plan)
  if (Object.keys(nestedPlan).length > 0) {
    const foundInNestedPlan = findPlanProperty(nestedPlan, property)
    if (foundInNestedPlan !== undefined) return foundInNestedPlan
  }
  const childPlans = Array.isArray(plan.Plans) ? plan.Plans : []
  for (const child of childPlans) {
    const found = findPlanProperty(recordValue(child), property)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Capture one query plan outside the timed samples.
 * EXPLAIN ANALYZE adds work and changes cache state, so the profile is kept as
 * diagnosis evidence and never mixed with the latency samples used for the
 * before and after verdict.
 */
async function captureProfile(
  pool: Pool,
  query: ProfileQuery,
): Promise<PlanSummary> {
  const result = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
    [...query.params],
  )
  const explainRow = recordValue(result.rows[0])
  const payload = Array.isArray(explainRow['QUERY PLAN'])
    ? explainRow['QUERY PLAN'][0]
    : {}
  const root = recordValue(payload)
  const plan = recordValue(root.Plan)
  const numberProperty = (property: string): number => {
    const value = findPlanProperty(root, property)
    return typeof value === 'number' ? value : 0
  }
  const stringProperty = (property: string): string | null => {
    const value = findPlanProperty(plan, property)
    return typeof value === 'string' ? value : null
  }
  return {
    planningMs: numberProperty('Planning Time'),
    executionMs: numberProperty('Execution Time'),
    nodeType:
      typeof plan['Node Type'] === 'string' ? plan['Node Type'] : 'unknown',
    indexName: stringProperty('Index Name'),
    sortMethod: stringProperty('Sort Method'),
    sharedHitBlocks: numberProperty('Shared Hit Blocks'),
    sharedReadBlocks: numberProperty('Shared Read Blocks'),
  }
}

/**
 * Create one source database, clone it, and apply the candidate index only to
 * the treatment copy. The current migration contains the fix, so dropping the
 * index from the source gives a true before state without an older migration
 * chain or a second seed pass.
 */
async function provisionFixturePair(
  adminUrl: string,
  scale: Scale,
  state: DatabasePairState,
): Promise<FixturePair> {
  const stamp = `${Date.now()}-${process.pid}-${scale}`
  const sourceName = `garden_load_source_${stamp}`
  const treatmentName = `garden_load_after_${stamp}`
  state.names.push(sourceName, treatmentName)
  await createDatabase(adminUrl, sourceName)
  const sourceUrl = databaseUrl(adminUrl, sourceName)
  await migrateDatabase(sourceUrl)

  const sourcePool = createBenchmarkPool(sourceUrl, 8)
  await sourcePool.query(
    `drop index if exists ${quoteIdentifier(CANDIDATE_INDEX)}`,
  )
  await sourcePool.end()
  const seeded = await seedDatabase(sourceUrl, scale)

  await createDatabase(adminUrl, treatmentName, sourceName)
  const treatmentUrl = databaseUrl(adminUrl, treatmentName)
  const treatmentPool = createBenchmarkPool(treatmentUrl, 8)
  await treatmentPool.query(
    `create index if not exists ${quoteIdentifier(CANDIDATE_INDEX)}
     on issue using btree
       (workspace_id, updated_at desc nulls last,
        created_at desc nulls last, number desc nulls last)`,
  )
  await treatmentPool.query('ANALYZE')
  const beforePool = createBenchmarkPool(sourceUrl, 8)
  await beforePool.query('ANALYZE')

  return {
    beforePool,
    afterPool: treatmentPool,
    ids: seeded.ids,
    counts: seeded.counts,
    close: async () => {
      await beforePool.end()
      await treatmentPool.end()
    },
  }
}

/**
 * Run all scenarios for one scale and one isolated before and after pair.
 * The run warms both copies, alternates sample order, checks equal result
 * witnesses, and records profiles for scenarios with a diagnostic query.
 */
async function measureScale(
  pair: FixturePair,
  scale: Scale,
  options: Options,
): Promise<ScenarioMeasurement[]> {
  const measurements: ScenarioMeasurement[] = []
  for (const scenario of queryScenarios()) {
    const beforeProfile = scenario.profile
      ? await captureProfile(pair.beforePool, scenario.profile(pair.ids))
      : null
    const afterProfile = scenario.profile
      ? await captureProfile(pair.afterPool, scenario.profile(pair.ids))
      : null
    await timeScenario(scenario, pair.beforePool, pair.ids, 1)
    await timeScenario(scenario, pair.afterPool, pair.ids, 1)

    const before: TimedSample[] = []
    const after: TimedSample[] = []
    let errors = 0
    for (
      let repetition = 0;
      repetition < options.repetitions;
      repetition += 1
    ) {
      const beforeFirst = sampleOrderBit(
        scale * 10_000 + repetition * 101 + scenario.id.length,
      )
      const first = beforeFirst
        ? await timeScenario(
            scenario,
            pair.beforePool,
            pair.ids,
            options.concurrency,
          )
        : await timeScenario(
            scenario,
            pair.afterPool,
            pair.ids,
            options.concurrency,
          )
      const second = beforeFirst
        ? await timeScenario(
            scenario,
            pair.afterPool,
            pair.ids,
            options.concurrency,
          )
        : await timeScenario(
            scenario,
            pair.beforePool,
            pair.ids,
            options.concurrency,
          )
      const beforeSample = beforeFirst ? first : second
      const afterSample = beforeFirst ? second : first
      before.push(beforeSample)
      after.push(afterSample)
      errors += Number(Boolean(beforeSample.error))
      errors += Number(Boolean(afterSample.error))
      if (
        beforeSample.error === null &&
        afterSample.error === null &&
        beforeSample.checksum !== afterSample.checksum
      ) {
        throw new Error(
          `${scenario.id} returned different result witnesses at ${scale}x`,
        )
      }
    }
    const statistics = calculateStatistics(before, after, errors)
    measurements.push({
      scale,
      scenarioId: scenario.id,
      label: scenario.label,
      description: scenario.description,
      repetitions: options.repetitions,
      concurrency: options.concurrency,
      before,
      after,
      errors,
      statistics,
      beforeProfile,
      afterProfile,
    })
    process.stdout.write(
      `${scale}x ${scenario.id} ${statistics.verdict} ` +
        `${formatMs(statistics.beforeMedianMs)} -> ${formatMs(statistics.afterMedianMs)} ` +
        `p=${formatNumber(statistics.signFlipPValue)}\n`,
    )
  }
  return measurements
}

/**
 * Run the complete multi-scale benchmark and return its report data.
 * Database provisioning is kept outside the measurement functions so the
 * report can separate fixture cost, profile cost, and query latency.
 */
async function runBenchmark(
  options: Options,
  state: DatabasePairState,
): Promise<BenchmarkReport> {
  const env = getServerEnv()
  const adminUrl = env.DATABASE_URL
  const versionClient = new Client({ connectionString: adminUrl })
  await versionClient.connect()
  const versionResult = await versionClient.query(
    `select current_setting('server_version') as version`,
  )
  await versionClient.end()
  const postgresVersion = String(versionResult.rows[0]?.version ?? 'unknown')
  const measurements: ScenarioMeasurement[] = []
  for (const scale of options.scales) {
    process.stdout.write(`seeding ${scale}x fixture\n`)
    const pair = await provisionFixturePair(adminUrl, scale, state)
    const scaleMeasurements = await measureScale(pair, scale, options)
    measurements.push(...scaleMeasurements)
    await pair.close()
    if (!options.keepDatabases) {
      const beforeName = state.names[state.names.length - 2]
      const afterName = state.names[state.names.length - 1]
      if (!beforeName || !afterName) {
        throw new Error(
          `Missing temporary database names for ${scale}x cleanup`,
        )
      }
      await dropDatabase(adminUrl, beforeName)
      await dropDatabase(adminUrl, afterName)
      state.names.splice(-2)
    }
  }
  const hostLoad = await readHostLoad()
  const cpuCount = availableParallelism()
  return {
    generatedAt: new Date().toISOString(),
    database: {
      postgresVersion,
      candidateIndex: CANDIDATE_INDEX,
      baseline: 'same seeded database with the candidate index removed',
      treatment: 'same seeded database clone with the candidate index present',
    },
    method: {
      scales: options.scales,
      repetitions: options.repetitions,
      concurrency: options.concurrency,
      warmupRuns: 1,
      confidenceLevel: 0.95,
      significanceLevel: 0.05,
      hostLoad,
      cpuCount,
    },
    measurements,
  }
}

/**
 * Read the host load supplied by the launcher without adding a process probe
 * inside the timed benchmark. The command wrapper records the same machine
 * state in the report when `uptime` is available.
 */
async function readHostLoad(): Promise<string> {
  return process.env.LOAD_TEST_HOST_LOAD ?? 'not recorded'
}

/**
 * Format a latency for the console and Markdown report.
 * Keeping units in every number prevents a raw `0.4` from being read as
 * seconds in one place and milliseconds in another.
 */
function formatMs(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)} ms` : 'n/a'
}

/**
 * Format a statistic with enough precision to compare close samples.
 * The full JSON report retains the raw number for later analysis.
 */
function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a'
}

/**
 * Escape report text for SVG output.
 * Scenario names and errors are data, so the chart must not treat them as XML.
 */
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Render a compact before and after latency chart.
 * A logarithmic x scale keeps 10x, 100x, and 1000x query results visible when
 * one workspace-wide scan is much slower than a point lookup.
 */
function renderSvg(report: BenchmarkReport): string {
  const rows = report.measurements
  const width = 1240
  const left = 330
  const right = 180
  const rowHeight = 50
  const top = 80
  const height = top + rows.length * rowHeight + 50
  const finiteValues = rows.flatMap((row) => [
    row.statistics.beforeMedianMs,
    row.statistics.afterMedianMs,
  ])
  const maximum = Math.max(...finiteValues.filter(Number.isFinite), 1)
  const chartWidth = width - left - right
  const xFor = (value: number) =>
    left +
    (Math.log10(Math.max(value, 0) + 1) / Math.log10(maximum + 1)) * chartWidth
  const scaleTicks = [0, 0.1, 1, 10, 100, 1000, 10_000].filter(
    (value) => value <= maximum * 1.05 || value === 0,
  )
  const tickMarkup = scaleTicks
    .map((value) => {
      const x = xFor(value)
      return `<line x1="${x}" y1="${top - 20}" x2="${x}" y2="${height - 35}" stroke="#e2e8f0"/><text x="${x}" y="${top - 28}" text-anchor="middle" font-size="11" fill="#475569">${value} ms</text>`
    })
    .join('')
  const rowMarkup = rows
    .map((row, index) => {
      const y = top + index * rowHeight
      const beforeX = xFor(row.statistics.beforeMedianMs)
      const afterX = xFor(row.statistics.afterMedianMs)
      const beforeWidth = Math.max(beforeX - left, 1)
      const afterWidth = Math.max(afterX - left, 1)
      const status = `${row.statistics.verdict}, p=${formatNumber(row.statistics.signFlipPValue)}`
      return `<g><text x="12" y="${y + 14}" font-size="12" font-weight="600" fill="#0f172a">${row.scale}x ${escapeXml(row.label)}</text><text x="12" y="${y + 31}" font-size="10" fill="#64748b">${escapeXml(status)}</text><rect x="${left}" y="${y}" width="${beforeWidth}" height="10" rx="4" fill="#f59e0b"/><rect x="${left}" y="${y + 15}" width="${afterWidth}" height="10" rx="4" fill="#10b981"/><text x="${width - right + 12}" y="${y + 9}" font-size="10" fill="#92400e">before ${escapeXml(formatMs(row.statistics.beforeMedianMs))}</text><text x="${width - right + 12}" y="${y + 24}" font-size="10" fill="#047857">after ${escapeXml(formatMs(row.statistics.afterMedianMs))}</text></g>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="12" y="28" font-size="20" font-weight="700" fill="#0f172a">Garden database load test</text><text x="12" y="52" font-size="12" fill="#475569">Median wall time. Orange before index. Green after index. Logarithmic x scale.</text><rect x="${left}" y="${top - 20}" width="${chartWidth}" height="${height - top - 15}" fill="#f8fafc"/>${tickMarkup}${rowMarkup}<rect x="${left}" y="${height - 24}" width="12" height="8" fill="#f59e0b"/><text x="${left + 18}" y="${height - 16}" font-size="11" fill="#475569">before</text><rect x="${left + 80}" y="${height - 24}" width="12" height="8" fill="#10b981"/><text x="${left + 98}" y="${height - 16}" font-size="11" fill="#475569">after</text></svg>`
}

/**
 * Render the text report that accompanies the chart and JSON artifact.
 * The report states the result, sample contract, and evidence limits so a
 * reader cannot mistake a local synthetic run for a production capacity claim.
 */
function renderMarkdown(report: BenchmarkReport): string {
  const rows = report.measurements
    .map((row) => {
      const stats = row.statistics
      return `| ${row.scale}x | ${row.label} | ${formatMs(stats.beforeMedianMs)} | ${formatMs(stats.afterMedianMs)} | ${stats.changePercent.toFixed(1)}% | ${formatNumber(stats.signFlipPValue)} | ${stats.verdict} |`
    })
    .join('\n')
  const profileRows = report.measurements
    .filter((row) => row.beforeProfile && row.afterProfile)
    .map((row) => {
      const before = row.beforeProfile
      const after = row.afterProfile
      if (!before || !after) return ''
      return `| ${row.scale}x | ${row.label} | ${before.nodeType} / ${before.indexName ?? 'none'} / ${before.sortMethod ?? 'none'} | ${after.nodeType} / ${after.indexName ?? 'none'} / ${after.sortMethod ?? 'none'} | ${before.sharedHitBlocks}/${before.sharedReadBlocks} | ${after.sharedHitBlocks}/${after.sharedReadBlocks} |`
    })
    .filter(Boolean)
    .join('\n')
  return `# Garden database load test

Generated ${report.generatedAt} against PostgreSQL ${report.database.postgresVersion}.

The suite seeded one isolated workspace at ${report.method.scales.map((scale) => `${scale}x`).join(', ')}. It ran ${report.method.repetitions} paired samples per query and scale, with ${report.method.concurrency} concurrent calls in each sample. It used one warmup call per side. The before copy removed \`${report.database.candidateIndex}\`. The after copy added it.

## Results

| Scale | Query | Before median | After median | Change | Sign-flip p | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- |
${rows}

## Query plans

The plan columns show node, index, and sort method. Buffer columns show shared
hit/read blocks. The candidate index did not appear in the captured plans.

| Scale | Query | Before plan | After plan | Before buffers | After buffers |
| --- | --- | --- | --- | ---: | ---: |
${profileRows}

The confidence interval uses paired bootstrap resampling at 95%. The sign-flip test uses a 0.05 significance level. A result is inconclusive when a sample errors or fewer than five paired samples remain.

The query rows were consumed and before and after full row-multiset checksums were compared. The comparison ignores row order inside each result set because the search query has non-unique timestamp ties. Profiles use \`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\` outside the timed samples. The profile is diagnostic evidence, not part of the latency number.

The benchmark does not measure HTTP, Workers, external connectors, network latency, or production traffic. Repeat it against a production-sized clone before making a capacity promise.
`
}

/**
 * Write rerunnable benchmark artifacts to the requested local directory.
 * JSON supports later analysis, SVG gives a direct visual comparison, and
 * Markdown gives a short handoff that names the statistical limits.
 */
function writeReport(report: BenchmarkReport, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(
    resolve(outputDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  writeFileSync(resolve(outputDir, 'report.svg'), renderSvg(report))
  writeFileSync(resolve(outputDir, 'report.md'), renderMarkdown(report))
}

/**
 * Close any database names still tracked after a failed or kept run.
 * The cleanup list is explicit, so failure recovery cannot drop a developer's
 * configured Garden database.
 */
async function cleanupDatabases(
  adminUrl: string,
  state: DatabasePairState,
  keepDatabases: boolean,
): Promise<void> {
  if (keepDatabases) return
  for (const name of [...state.names].reverse()) {
    await dropDatabase(adminUrl, name)
  }
  state.names.length = 0
}

/**
 * Run the command-line benchmark and write its artifacts.
 * The rejection handler cleans temporary databases before setting a failing
 * exit code, so an interrupted load run does not leave large local databases.
 */
function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const adminUrl = getServerEnv().DATABASE_URL
  const state: DatabasePairState = { names: [] }
  runBenchmark(options, state).then(
    (report) => {
      writeReport(report, options.outputDir)
      return cleanupDatabases(adminUrl, state, options.keepDatabases).then(
        () => {
          process.stdout.write(
            `wrote ${resolve(options.outputDir, 'report.md')}\n`,
          )
          process.stdout.write(
            `wrote ${resolve(options.outputDir, 'report.svg')}\n`,
          )
        },
      )
    },
    (cause: unknown) =>
      cleanupDatabases(adminUrl, state, options.keepDatabases).then(() => {
        console.error(`database load test failed: ${errorMessage(cause)}`)
        process.exitCode = 1
      }),
  )
}

main()
