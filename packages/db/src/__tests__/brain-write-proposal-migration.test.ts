import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = resolve(here, '../../drizzle')
const cli = resolve(here, '../../../../node_modules/drizzle-kit/bin.cjs')
const migrationTag = '0051_classy_king_bedlam'
const guardMessage =
  'Brain proposal migration requires review of duplicate legacy claim hashes; no rows were deleted'
type CliResult = {
  code: number | null
  output: string
  applicationName: string
}
type LegacyProposal = {
  workspace: string
  hash: string
  claim: string
  scope: Record<string, string>
  status: 'pending' | 'approved' | 'rejected'
}

describe('0051 populated Brain proposal migration (PostgreSQL CLI)', () => {
  let postgres: StartedTestContainer
  let admin: Pool
  let pool: Pool
  let directory: string
  let preFolder: string
  let fullFolder: string
  let databaseName: string
  let databaseUrl: string
  let logStream: Readable
  let postgresLogs = ''
  const children: Array<{ child: ChildProcess; done: Promise<CliResult> }> = []
  let workspace: string
  let secondWorkspace: string
  let reviewer: string

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'garden-0051-migration-'))
    preFolder = resolve(directory, 'before-0051')
    fullFolder = resolve(directory, 'candidate')
    await cp(migrations, preFolder, { recursive: true })
    await cp(migrations, fullFolder, { recursive: true })
    const journal = JSON.parse(
      await readFile(resolve(migrations, 'meta/_journal.json'), 'utf8'),
    )
    expect(journal.entries.at(-1).tag).toBe(migrationTag)
    await writeFile(
      resolve(preFolder, 'meta/_journal.json'),
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(
          (entry: { tag: string }) => entry.tag !== migrationTag,
        ),
      }),
    )
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test',
      })
      .withCommand([
        'postgres',
        '-c',
        'log_statement=all',
        '-c',
        'log_line_prefix=%a|',
        '-c',
        'log_error_verbosity=verbose',
      ])
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
      )
      .start()
    logStream = await postgres.logs()
    logStream.on('data', (chunk) => {
      postgresLogs += String(chunk)
    })
    admin = new Pool({
      connectionString: `postgres://test:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/test`,
    })
  })

  beforeEach(async () => {
    databaseName = `migration_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    databaseUrl = `postgres://test:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/${databaseName}`
    pool = new Pool({ connectionString: databaseUrl })
    const baseline = await runMigration(preFolder).then((run) => run.done)
    expect(baseline.code, baseline.output).toBe(0)
    expect(
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name='brain_write_proposal' AND column_name='operation_key'`,
        )
      ).rows,
    ).toHaveLength(0)
    workspace = randomUUID()
    secondWorkspace = randomUUID()
    reviewer = randomUUID()
    await pool.query(
      'INSERT INTO "organization" (id,name,slug) VALUES ($1::uuid,$2,$1::text),($3::uuid,$4,$3::text)',
      [workspace, 'First workspace', secondWorkspace, 'Second workspace'],
    )
    await pool.query('INSERT INTO "user" (id,email,name) VALUES ($1,$2,$3)', [
      reviewer,
      `${reviewer}@example.test`,
      'Synthetic reviewer',
    ])
  })

  afterEach(async () => {
    // Only processes and disposable databases created by this suite are owned here.
    for (const { child } of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL')
    await Promise.allSettled(children.map((run) => run.done))
    children.length = 0
    await pool?.end()
    if (databaseName)
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  })

  afterAll(async () => {
    await admin?.end()
    logStream?.destroy()
    await postgres?.stop()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  /** Runs the production Drizzle CLI with an explicit isolated config, never the root .env loader. */
  async function runMigration(folder = fullFolder) {
    const applicationName = `migrate_${randomUUID().replaceAll('-', '')}`
    const config = resolve(directory, `${applicationName}.config.ts`)
    const url = new URL(databaseUrl)
    url.searchParams.set('application_name', applicationName)
    await writeFile(
      config,
      `export default ${JSON.stringify({
        dialect: 'postgresql',
        out: folder,
        dbCredentials: { url: url.toString() },
        migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
      })}\n`,
    )
    const child = spawn(
      process.execPath,
      [cli, 'migrate', '--config', config],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    const done = new Promise<CliResult>((resolveResult, reject) => {
      child.on('error', reject)
      child.on('close', (code) => {
        console.info(
          'G08_MIGRATION_CLI',
          JSON.stringify({ applicationName, code, output }),
        )
        resolveResult({ code, output, applicationName })
      })
    })
    children.push({ child, done })
    return { done, applicationName }
  }

  /** Seeds the real pre-0051 table, including review evidence that must never be discarded. */
  async function insertProposal(
    input: LegacyProposal,
    client: Pool | PoolClient = pool,
  ) {
    const id = randomUUID()
    await client.query(
      `INSERT INTO brain_write_proposal
      (id,workspace_id,run_id,claim_hash,claim,kind,confidence,scope,evidence,status,decided_by,decided_at,created_at)
      VALUES ($1,$2,$3,$4,$5,'decision',0.7,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        input.workspace,
        `run-${id}`,
        input.hash,
        input.claim,
        input.scope,
        JSON.stringify([`evidence-${id}`]),
        input.status,
        input.status === 'pending' ? null : reviewer,
        input.status === 'pending' ? null : '2026-10-01T12:00:00Z',
        '2026-09-30T12:00:00Z',
      ],
    )
    return id
  }

  /** Captures retained values and PostgreSQL schema/index/journal state, rather than relying on CLI exit alone. */
  async function snapshot() {
    const [rows, columns, indexes, constraints, journal] = await Promise.all([
      pool.query(
        'SELECT to_jsonb(p) AS value FROM brain_write_proposal p ORDER BY id',
      ),
      pool.query(`SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='brain_write_proposal'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`),
      pool.query(
        `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='brain_write_proposal' ORDER BY indexname`,
      ),
      pool.query(
        `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='brain_write_proposal'::regclass ORDER BY conname`,
      ),
      pool.query(
        'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      ),
    ])
    return {
      rows: rows.rows.map((row) => row.value),
      columns: columns.rows,
      indexes: indexes.rows,
      constraints: constraints.rows,
      journal: journal.rows,
    }
  }

  /** Rejected preflight must execute before the first destructive/rewriting statement, even though DDL is transactional. */
  async function expectGuardBeforeDdl(result: CliResult) {
    expect(result.code, result.output).not.toBe(0)
    const lines = await transactionLogs(result)
    const errors = lines
      .filter((line) => line.startsWith(`${result.applicationName}|ERROR:`))
      .join('\n')
    expect(errors).toContain(guardMessage)
    expect(errors).toContain('P0001')
    expect(
      lines.some((line) =>
        /statement:\s*(DROP INDEX|ALTER TABLE|UPDATE "brain_write_proposal"|DELETE)/i.test(
          line,
        ),
      ),
    ).toBe(false)
  }

  /** PostgreSQL's completed rollback anchors log drainage; this CLI version can omit error text on pipes. */
  async function transactionLogs(result: CliResult) {
    const lines = () =>
      postgresLogs
        .split(
          /(?=^[^|\n]*\|(?:LOG|ERROR|DETAIL|HINT|CONTEXT|STATEMENT|LOCATION):)/m,
        )
        .filter((line) => line.startsWith(`${result.applicationName}|`))
    await expect
      .poll(() => lines().some((line) => /statement:\s*rollback\b/i.test(line)))
      .toBe(true)
    console.info(
      'G08_MIGRATION_POSTGRES',
      JSON.stringify({
        applicationName: result.applicationName,
        lines: lines(),
      }),
    )
    return lines()
  }

  it('rejects ambiguous retained rows before any DDL and preserves every value on retry', async () => {
    for (const [status, scope, claim] of [
      ['pending', { kind: 'org' }, 'First distinct retained claim'],
      [
        'approved',
        { kind: 'user', userId: reviewer },
        'Second approved private claim',
      ],
      [
        'rejected',
        { kind: 'team', teamId: randomUUID() },
        'Third rejected team claim',
      ],
    ] as const)
      await insertProposal({
        workspace,
        hash: 'legacy-collision',
        claim,
        scope,
        status,
      })
    const before = await snapshot()
    expect(before.rows).toHaveLength(3)
    const result = await runMigration().then((run) => run.done)
    const after = await snapshot()
    console.info(
      'G08_MIGRATION_PRESERVATION',
      JSON.stringify({ before, after }),
    )
    // Soft assertions make the old destructive migration show the actual lost rows as well as the missing rejection.
    expect.soft(after).toEqual(before)
    await expectGuardBeforeDdl(result)
    const retry = await runMigration().then((run) => run.done)
    await expectGuardBeforeDdl(retry)
    expect(await snapshot()).toEqual(before)
  })

  it('backfills clean retained rows and adds both indexes once, with a no-op retry', async () => {
    await insertProposal({
      workspace,
      hash: 'first-hash',
      claim: 'Approved retained claim',
      scope: { kind: 'org' },
      status: 'approved',
    })
    await insertProposal({
      workspace,
      hash: 'second-hash',
      claim: 'Rejected retained claim',
      scope: { kind: 'user', userId: reviewer },
      status: 'rejected',
    })
    const before = await snapshot()
    const result = await runMigration().then((run) => run.done)
    expect(result.code, result.output).toBe(0)
    const after = await snapshot()
    expect(after.rows).toEqual(
      before.rows.map((row) => ({
        ...row,
        operation_key: `${row.run_id}:${row.claim_hash}`,
      })),
    )
    expect(
      after.columns.find((column) => column.attname === 'operation_key'),
    ).toMatchObject({ type: 'text', attnotnull: true })
    expect(after.indexes.map((index) => index.indexname)).not.toContain(
      'brain_write_proposal_run_claim_idx',
    )
    expect(after.indexes).toEqual(
      expect.arrayContaining([
        {
          indexname: 'brain_write_proposal_operation_unique',
          indexdef:
            'CREATE UNIQUE INDEX brain_write_proposal_operation_unique ON public.brain_write_proposal USING btree (workspace_id, operation_key)',
        },
        {
          indexname: 'brain_write_proposal_claim_unique',
          indexdef:
            'CREATE UNIQUE INDEX brain_write_proposal_claim_unique ON public.brain_write_proposal USING btree (workspace_id, claim_hash)',
        },
      ]),
    )
    const sql = await readFile(
      resolve(fullFolder, `${migrationTag}.sql`),
      'utf8',
    )
    expect(after.journal).toHaveLength(before.journal.length + 1)
    expect(after.journal.at(-1)?.hash).toBe(
      createHash('sha256').update(sql).digest('hex'),
    )
    expect((await runMigration().then((run) => run.done)).code).toBe(0)
    expect(await snapshot()).toEqual(after)
  })

  it('allows the same legacy hash in separate workspaces without merging rows', async () => {
    for (const owner of [workspace, secondWorkspace])
      await insertProposal({
        workspace: owner,
        hash: 'shared-hash',
        claim: `Retained workspace claim ${owner}`,
        scope: { kind: 'org' },
        status: 'pending',
      })
    const before = await snapshot()
    const result = await runMigration().then((run) => run.done)
    expect(result.code, result.output).toBe(0)
    expect((await snapshot()).rows).toEqual(
      before.rows.map((row) => ({
        ...row,
        operation_key: `${row.run_id}:${row.claim_hash}`,
      })),
    )
  })

  it('rolls back all 0051 changes when a concurrent claim arrives after preflight', async () => {
    await insertProposal({
      workspace,
      hash: 'raced-hash',
      claim: 'Existing retained claim',
      scope: { kind: 'org' },
      status: 'pending',
    })
    const before = await snapshot()
    const holder = await pool.connect()
    let run: Awaited<ReturnType<typeof runMigration>> | undefined
    let collisionId: string | undefined
    let concurrentRow: Record<string, unknown> | undefined
    try {
      await holder.query('BEGIN')
      await holder.query(
        'LOCK TABLE brain_write_proposal IN ROW EXCLUSIVE MODE',
      )
      run = await runMigration()
      const applicationName = run.applicationName
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                `SELECT query,wait_event_type FROM pg_stat_activity WHERE application_name=$1`,
                [applicationName],
              )
            ).rows,
          { timeout: 10000 },
        )
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              query: expect.stringContaining(
                'DROP INDEX "brain_write_proposal_run_claim_idx"',
              ),
              wait_event_type: 'Lock',
            }),
          ]),
        )
      collisionId = await insertProposal(
        {
          workspace,
          hash: 'raced-hash',
          claim: 'Concurrent distinct private claim',
          scope: { kind: 'user', userId: reviewer },
          status: 'approved',
        },
        holder,
      )
      concurrentRow = (
        await holder.query(
          'SELECT to_jsonb(p) AS value FROM brain_write_proposal p WHERE id=$1',
          [collisionId],
        )
      ).rows[0].value
      await holder.query('COMMIT')
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
    expect(run).toBeDefined()
    expect(collisionId).toBeDefined()
    const result = await run!.done
    expect(result.code, result.output).not.toBe(0)
    const records = await transactionLogs(result)
    const failedTransaction = records.join('\n')
    const errors = records
      .filter((record) => record.startsWith(`${result.applicationName}|ERROR:`))
      .join('\n')
    // Positive controls prove multiline log parsing detects actual migrated DDL and backfill.
    for (const statement of ['DROP INDEX', 'ALTER TABLE', 'UPDATE'])
      expect(failedTransaction).toMatch(
        new RegExp(`statement:\\s*${statement}`),
      )
    expect(errors).toContain('23505')
    expect(errors).toContain('brain_write_proposal_claim_unique')
    expect(errors).not.toContain(guardMessage)
    const after = await snapshot()
    expect(after.rows).toHaveLength(2)
    expect(after.rows.find((row) => row.id === before.rows[0].id)).toEqual(
      before.rows[0],
    )
    expect(concurrentRow).toBeDefined()
    expect(after.rows.find((row) => row.id === collisionId)).toEqual(
      concurrentRow,
    )
    expect(after.columns).toEqual(before.columns)
    expect(after.indexes).toEqual(before.indexes)
    expect(after.constraints).toEqual(before.constraints)
    expect(after.journal).toEqual(before.journal)
    const retry = await runMigration().then((attempt) => attempt.done)
    await expectGuardBeforeDdl(retry)
    expect(await snapshot()).toEqual(after)
  })
})
