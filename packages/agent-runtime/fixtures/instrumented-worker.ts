import { createTestHarness, type Unstable_RawConfig } from 'wrangler'
import { transform } from 'esbuild'
import { createInstrumenter } from 'istanbul-lib-instrument'
import { createSourceMapStore } from 'istanbul-lib-source-maps'
import {
  createCoverageMap,
  type CoverageMapData,
  type FileCoverageData,
} from 'istanbul-lib-coverage'
import {
  mkdtemp,
  writeFile,
  readFile,
  cp,
  symlink,
  readdir,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const candidateProductionFiles = [
  'agent-tools/brain.ts',
  'brain-write-back-sub-agent.ts',
  'issue-run-sub-agent.ts',
  'issue-brain-audience.ts',
  'automation-run-sub-agent.ts',
  'brain-run-authority.ts',
  'brain-write-back.ts',
  'chat-sub-agent-tools.ts',
  'agent-do.ts',
]
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const snapshotSource = `function __g06Snapshot(role, runId) {
  globalThis.__g06Isolate ??= crypto.randomUUID();
  globalThis.__g06Sequence = (globalThis.__g06Sequence ?? 0) + 1;
  return { isolate: globalThis.__g06Isolate, sequence: globalThis.__g06Sequence, role, runId, metadata: globalThis.__g06Metadata ?? {},
    counters: Object.fromEntries(Object.entries(globalThis.__coverage__ ?? {}).map(([path, value]) => [path, { s: value.s, f: value.f, b: value.b }])) };
}`
const wrapSource = (
  className: string,
  methods: string[],
  counters: Record<string, { path: string; key: string }> = {},
) => `${snapshotSource}
${methods
  .map(
    (
      method,
      index,
    ) => `const __g06Original${index} = ${className}.prototype.${method};
if (typeof __g06Original${index} !== 'function' || __g06Original${index}.constructor.name !== 'AsyncFunction') throw new Error('Expected owned async method: ${className}.${method}');
${className}.prototype.${method} = async function(...args) {
  const target = ${JSON.stringify(counters[method] ?? null)};
  const before = target ? globalThis.__coverage__[target.path].f[target.key] : null;
  return await Promise.resolve(__g06Original${index}.apply(this, args)).finally(() => {
    const snapshot = __g06Snapshot('${className}.${method}', ('${method}' === 'validateBrainSummaryAccess' ? args[0] : undefined) ?? args[0]?.runId ?? args[1]?.runId ?? args[0]?.metadata?.runId ?? this.currentRunId ?? this.getConfig()?.runId ?? this.name);
    snapshot.target = target ? {...target, before, after: globalThis.__coverage__[target.path].f[target.key]} : null;
    snapshot.identityKind = '${className}' === 'ChatSubAgent' ? 'thread' : 'run';
    snapshot.invocation = '${method}' === 'executeWorkflowTurn' ? String(args[1]?.turn) + ':' + args[0] : '${method}' === 'completeWorkflowTurn' ? args[0]?.submissionId : '${method}';
    console.info('__G06_COV__:' + btoa(JSON.stringify(snapshot)));
  });
};`,
  )
  .join('\n')}`

type Counters = Pick<FileCoverageData, 's' | 'f' | 'b'>
type Snapshot = {
  isolate: string
  sequence: number
  role: string
  runId: string
  target?: { path: string; key: string; before: number; after: number } | null
  invocation: string
  identityKind?: string
  metadata: Record<string, { sourceHash: string; mapHash: string }>
  counters: Record<string, Counters>
}

type ExpectedBoundary = {
  role: string
  runId: string
  invocation: string
  count: number
}

/** Rejects dropped receipts even when another run emitted the same role. */
export function missingNativeBoundaries(
  snapshots: Pick<
    Snapshot,
    'role' | 'runId' | 'invocation' | 'isolate' | 'sequence'
  >[],
  expected: ExpectedBoundary[],
) {
  const distinct = [
    ...new Map(
      snapshots.map((snapshot) => [
        JSON.stringify([snapshot.isolate, snapshot.sequence]),
        snapshot,
      ]),
    ).values(),
  ]
  return expected.filter(
    (boundary) =>
      distinct.filter(
        (snapshot) =>
          snapshot.role === boundary.role &&
          snapshot.runId === boundary.runId &&
          snapshot.invocation === boundary.invocation,
      ).length < boundary.count,
  )
}

/**
 * Instruments only owned application modules in an isolated source overlay.
 * Wrangler still owns the actual Worker, Workflow, facet and storage runtime.
 * Generated wrappers emit counters before the SDK reclaims write-back facets.
 */
export async function startInstrumentedHarness(
  config: Unstable_RawConfig,
  expectedRoles: string[],
  scenario: string,
) {
  if (process.env.G06_NATIVE_INSTRUMENTATION === '0') {
    const harness = createTestHarness({ root, workers: [{ config }] })
    return {
      listen: () => harness.listen(),
      fetch: (path: string, init?: Parameters<typeof harness.fetch>[1]) =>
        harness.fetch(path, init),
      getLogs: () => harness.getLogs(),
      debug: () => console.info(JSON.stringify(harness.getLogs())),
      close: async () => {
        await harness.close()
        console.info(
          'G06 uninstrumented native parity run: no native coverage claimed',
        )
      },
    }
  }
  const isBaseline = process.env.G06_NATIVE_BASELINE === '1'
  const isG08Baseline = process.env.G08_NATIVE_BASELINE === '1'
  if (
    isG08Baseline &&
    existsSync(join(root, 'packages/agent-runtime/src/brain-run-authority.ts'))
  )
    throw new Error('G08 baseline must not include candidate grant helper')
  if (
    isBaseline &&
    existsSync(join(root, 'packages/agent-runtime/src/issue-brain-audience.ts'))
  )
    throw new Error(
      'Native baseline requires original source without the new audience helper',
    )
  const productionFiles = candidateProductionFiles.filter(
    (file) =>
      (!isBaseline || file !== 'issue-brain-audience.ts') &&
      (!isG08Baseline || file !== 'brain-run-authority.ts'),
  )
  const directory = await mkdtemp(join(tmpdir(), 'garden-g06-instrumented-'))
  await cp(
    join(root, 'packages/agent-runtime/src'),
    join(directory, 'packages/agent-runtime/src'),
    { recursive: true },
  )
  await cp(
    join(root, 'packages/agent-runtime/fixtures/brain-run-worker.ts'),
    join(directory, 'packages/agent-runtime/fixtures/brain-run-worker.ts'),
    { recursive: true },
  )
  await cp(
    join(root, 'packages/agent-runtime/package.json'),
    join(directory, 'packages/agent-runtime/package.json'),
  )
  for (const name of [
    'node_modules',
    '.agents',
    'apps',
    'third_party',
    'package.json',
    'tsconfig.json',
  ]) {
    await symlink(join(root, name), join(directory, name))
  }
  for (const name of await readdir(join(root, 'packages'))) {
    if (name !== 'agent-runtime')
      await symlink(
        join(root, 'packages', name),
        join(directory, 'packages', name),
      )
  }
  await symlink(
    join(root, 'packages/agent-runtime/node_modules'),
    join(directory, 'packages/agent-runtime/node_modules'),
  )
  await cp(
    join(root, 'packages/agent-runtime/tsconfig.json'),
    join(directory, 'packages/agent-runtime/tsconfig.json'),
  )
  const templates: CoverageMapData = {}
  const metadata: Snapshot['metadata'] = {}
  for (const file of productionFiles) {
    const path = join(root, 'packages/agent-runtime/src', file)
    const source = await readFile(path, 'utf8')
    const compiled = await transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcemap: 'external',
      sourcefile: path,
    })
    const instrumenter = createInstrumenter({
      esModules: true,
      produceSourceMap: true,
      compact: false,
      coverageGlobalScope: 'globalThis',
      coverageGlobalScopeFunc: false,
    })
    let code = instrumenter.instrumentSync(
      compiled.code,
      path,
      JSON.parse(compiled.map),
    )
    const coverage = instrumenter.lastFileCoverage()
    const sourceMap = instrumenter.lastSourceMap()
    if (!coverage || !sourceMap)
      throw new Error(`Missing instrumentation maps for ${file}`)
    templates[path] = coverage
    metadata[path] = {
      sourceHash: digest(source),
      mapHash: digest(JSON.stringify(sourceMap)),
    }
    code += `\nglobalThis.__g06Metadata ??= {}; globalThis.__g06Metadata[${JSON.stringify(path)}] = ${JSON.stringify(metadata[path])};\n`
    const className =
      file === 'automation-run-sub-agent.ts'
        ? 'AutomationRunSubAgent'
        : file === 'issue-run-sub-agent.ts'
          ? 'IssueRunSubAgent'
          : 'BrainWriteBackSubAgent'
    const methods =
      file === 'issue-run-sub-agent.ts' ||
      file === 'automation-run-sub-agent.ts'
        ? [
            'executeWorkflowTurn',
            'completeWorkflowTurn',
            'onSubmissionStatus',
            ...(!isBaseline && !isG08Baseline
              ? ['validateBrainSummaryAccess']
              : []),
          ]
        : file === 'brain-write-back-sub-agent.ts'
          ? ['runWriteBack']
          : []
    const targetCounters: Record<string, { path: string; key: string }> = {}
    for (const method of methods) {
      const lines = compiled.code.split('\n')
      const matching = lines.flatMap((line, index) =>
        line.trimStart().startsWith(`async ${method}(`) ? [index + 1] : [],
      )
      if (matching.length !== 1)
        throw new Error(`Ambiguous method location: ${method}`)
      const functions = Object.entries(coverage.fnMap).filter(
        ([, value]) => value.decl.start.line === matching[0],
      )
      if (functions.length !== 1)
        throw new Error(`Missing native target counter: ${method}`)
      targetCounters[method] = { path, key: functions[0]![0] }
    }
    if (methods.length) code += wrapSource(className, methods, targetCounters)
    code += `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(sourceMap)).toString('base64')}\n`
    await writeFile(join(directory, 'packages/agent-runtime/src', file), code)
  }
  const agentPath = join(directory, 'packages/agent-runtime/src/agent-do.ts')
  await writeFile(
    agentPath,
    (await readFile(agentPath, 'utf8')) +
      '\n' +
      wrapSource('ChatSubAgent', ['onChatResponse']),
  )
  const fixturePath = join(
    directory,
    'packages/agent-runtime/fixtures/brain-run-worker.ts',
  )
  let fixture = await readFile(fixturePath, 'utf8')
  if (fixture.split('    const url = new URL(request.url)').length !== 2)
    throw new Error('Coverage entry insertion point is ambiguous')
  fixture = fixture.replace(
    '    const url = new URL(request.url)',
    `    const url = new URL(request.url)\n    if (url.pathname === '/coverage') return Response.json(__g06Snapshot('Worker.fetch', 'fixture-root'))`,
  )
  await writeFile(fixturePath, fixture + '\n' + snapshotSource)
  await writeFile(
    join(directory, 'instrumentation.json'),
    JSON.stringify(
      {
        scenario,
        expectedRoles,
        isBaseline,
        isG08Baseline,
        absentBaselineFiles: isBaseline
          ? ['issue-brain-audience.ts']
          : isG08Baseline
            ? ['brain-run-authority.ts']
            : [],
        metadata,
        templates,
      },
      null,
      2,
    ),
  )
  const harness = createTestHarness({
    root: directory,
    workers: [
      {
        config: {
          ...config,
          main: fixturePath,
          alias: {
            ...config.alias,
            '@garden/agent-runtime': join(
              directory,
              'packages/agent-runtime/src/index.ts',
            ),
          },
        },
      },
    ],
  })
  const expectedBoundaries: ExpectedBoundary[] = []
  const turns = new Map<string, number>()
  const requireBoundary = (
    role: string,
    runId: string,
    invocation = role.split('.').at(-1)!,
    distinctRequest = false,
  ) => {
    const existing = expectedBoundaries.find(
      (item) =>
        item.role === role &&
        item.runId === runId &&
        item.invocation === invocation,
    )
    if (distinctRequest && existing) existing.count += 1
    if (
      !expectedBoundaries.some(
        (item) =>
          item.role === role &&
          item.runId === runId &&
          item.invocation === invocation,
      )
    )
      expectedBoundaries.push({ role, runId, invocation, count: 1 })
  }
  let listening = false
  return {
    listen: async () => {
      await harness.listen()
      listening = true
      const buildRoot = join(directory, '.wrangler/tmp')
      await cp(buildRoot, join(directory, 'executed-bundle'), {
        recursive: true,
      })
      const builds = await readdir(buildRoot)
      const identities: Array<{ path: string; sha256: string }> = []
      for (const build of builds) {
        for (const name of await readdir(join(buildRoot, build))) {
          if (name.endsWith('.js') || name.endsWith('.js.map')) {
            const path = join(buildRoot, build, name)
            identities.push({
              path,
              sha256: digest(await readFile(path, 'utf8')),
            })
          }
        }
      }
      if (
        !identities.some((entry) => entry.path.endsWith('brain-run-worker.js'))
      )
        throw new Error('Executed native Worker bundle was not captured')
      const workerBundle = identities.find((entry) =>
        entry.path.endsWith('brain-run-worker.js'),
      )!
      const bundleText = await readFile(workerBundle.path, 'utf8')
      const bundleMap = JSON.parse(
        await readFile(`${workerBundle.path}.map`, 'utf8'),
      ) as { sources: string[]; sourcesContent: string[] }
      const resolutionProof = []
      for (const file of productionFiles) {
        const relative = `packages/agent-runtime/src/${file}`
        const sourcePath = join(root, relative)
        const sourceEntries = bundleMap.sources.flatMap((source, index) =>
          source.endsWith(relative) ? [index] : [],
        )
        if (
          sourceEntries.length !== 1 ||
          digest(bundleMap.sourcesContent[sourceEntries[0]!]!) !==
            metadata[sourcePath]!.sourceHash
        )
          throw new Error(
            `Executed bundle has missing, duplicate or different source: ${file}`,
          )
        const moduleHeaders = bundleText
          .split('\n')
          .filter((line) => line.startsWith('// ') && line.endsWith(relative))
        if (
          !moduleHeaders.length ||
          moduleHeaders.some((line) => line !== `// ${relative}`)
        )
          throw new Error(
            `Executed bundle imported production outside overlay: ${file}`,
          )
        const marker = `globalThis.__g06Metadata[${JSON.stringify(sourcePath)}] =`
        if (
          bundleText.split(marker).length !== 2 ||
          !bundleText.includes(metadata[sourcePath]!.mapHash)
        )
          throw new Error(
            `Executed bundle lost unique instrumentation body: ${file}`,
          )
        resolutionProof.push({
          file,
          sourceIndex: sourceEntries[0],
          sourceHash: metadata[sourcePath]!.sourceHash,
          moduleHeaders,
          instrumentedMapHash: metadata[sourcePath]!.mapHash,
        })
      }
      await writeFile(
        join(directory, 'bundle-resolution-proof.json'),
        JSON.stringify(resolutionProof, null, 2),
      )
      await writeFile(
        join(directory, 'bundle-identities.json'),
        JSON.stringify(identities, null, 2),
      )
    },
    fetch: (path: string, init?: Parameters<typeof harness.fetch>[1]) => {
      if (
        [
          '/start',
          '/resume',
          '/automation-start',
          '/automation-resume',
          '/automation-turn',
          '/issue-turn',
          '/writeback-origin',
          '/chat',
          '/writeback',
        ].includes(path)
      ) {
        if (typeof init?.body !== 'string')
          throw new Error('Native boundary input must declare its identity')
        const input = JSON.parse(init.body) as {
          runId: string
          threadId: string
          runKind?: 'issue' | 'automation'
          mode?: 'start' | 'resume'
          turn?: number
          expectCompletion?: boolean
        }
        if (path === '/chat')
          requireBoundary('ChatSubAgent.onChatResponse', input.threadId)
        else if (path === '/writeback' || path === '/writeback-origin') {
          requireBoundary(
            'BrainWriteBackSubAgent.runWriteBack',
            input.runId,
            'runWriteBack',
            true,
          )
          const validationRole = `${input.runKind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.validateBrainSummaryAccess`
          if (expectedRoles.includes(validationRole))
            requireBoundary(
              validationRole,
              input.runId,
              'validateBrainSummaryAccess',
              true,
            )
        } else {
          const start = input.mode === 'start' || path.endsWith('start')
          const runClass = path.startsWith('/automation-')
            ? 'AutomationRunSubAgent'
            : 'IssueRunSubAgent'
          const kind = path.startsWith('/automation-') ? 'automation' : 'issue'
          const turn =
            input.turn ?? (start ? 0 : (turns.get(input.runId) ?? 0) + 1)
          turns.set(input.runId, turn)
          const mode = start ? 'start' : 'resume'
          requireBoundary(
            `${runClass}.executeWorkflowTurn`,
            input.runId,
            `${turn}:${mode}`,
          )
          if (
            input.expectCompletion !== false &&
            expectedRoles.includes(`${runClass}.completeWorkflowTurn`)
          ) {
            requireBoundary(
              `${runClass}.completeWorkflowTurn`,
              input.runId,
              `${kind}-run:${input.runId}:${turn}:${mode}`,
            )
            if (
              expectedRoles.includes(`${runClass}.validateBrainSummaryAccess`)
            )
              requireBoundary(
                `${runClass}.validateBrainSummaryAccess`,
                input.runId,
              )
            if (expectedRoles.includes('BrainWriteBackSubAgent.runWriteBack'))
              requireBoundary(
                'BrainWriteBackSubAgent.runWriteBack',
                input.runId,
              )
          }
        }
      }
      return harness.fetch(path, init)
    },
    getLogs: () => harness.getLogs(),
    debug: () =>
      console.info(
        JSON.stringify(
          harness
            .getLogs()
            .filter((log) => !JSON.stringify(log).includes('__G06_COV__:')),
        ),
      ),
    close: async () => {
      if (!listening) {
        await harness.close()
        return
      }
      const collected = await Promise.allSettled([
        (async () => {
          const readReceipts = () =>
            harness.getLogs().flatMap((log) => {
              const encoded = JSON.stringify(log).match(
                /__G06_COV__:([A-Za-z0-9+/=]+)/,
              )?.[1]
              return encoded
                ? [
                    JSON.parse(
                      Buffer.from(encoded, 'base64').toString('utf8'),
                    ) as Snapshot,
                  ]
                : []
            })
          const drainStarted = Date.now()
          let receipts = readReceipts()
          while (
            missingNativeBoundaries(receipts, expectedBoundaries).length &&
            Date.now() - drainStarted < 5000
          ) {
            await delay(20)
            receipts = readReceipts()
          }
          const missing = missingNativeBoundaries(receipts, expectedBoundaries)
          await writeFile(
            join(directory, 'boundary-receipts.json'),
            JSON.stringify(
              {
                scenario,
                expectedBoundaries,
                missing,
                drainMs: Date.now() - drainStarted,
                receipts: receipts.map(
                  ({ role, runId, invocation, sequence, isolate }) => ({
                    role,
                    runId,
                    invocation,
                    sequence,
                    isolate,
                  }),
                ),
              },
              null,
              2,
            ),
          )
          if (missing.length)
            throw new Error(
              `Missing native role/run receipts: ${JSON.stringify(missing)}`,
            )
          const response = await harness.fetch('/coverage')
          if (!response.ok) throw new Error('Root coverage snapshot failed')
          const snapshots: Snapshot[] = [
            ...receipts,
            (await response.json()) as Snapshot,
          ]
          for (const role of expectedRoles) {
            const emitted = snapshots.filter(
              (snapshot) => snapshot.role === role,
            )
            if (emitted.length === 0)
              throw new Error(`Missing native facet coverage: ${role}`)
            if (
              !role.startsWith('ChatSubAgent') &&
              !emitted.every(
                (snapshot) =>
                  snapshot.target &&
                  snapshot.target.after > snapshot.target.before &&
                  snapshot.counters[snapshot.target.path]?.f[
                    snapshot.target.key
                  ] === snapshot.target.after,
              )
            )
              throw new Error(
                `Native boundary did not execute its owned function: ${role}`,
              )
          }
          const instances = new Map<string, Record<string, Counters>>()
          const sequences = new Map<string, Map<number, string>>()
          for (const snapshot of [...snapshots].sort(
            (a, b) => a.sequence - b.sequence,
          )) {
            if (
              !Number.isSafeInteger(snapshot.sequence) ||
              snapshot.sequence < 1
            )
              throw new Error('Invalid coverage sequence')
            const seen =
              sequences.get(snapshot.isolate) ?? new Map<number, string>()
            sequences.set(snapshot.isolate, seen)
            const serialized = JSON.stringify(snapshot)
            if (
              seen.has(snapshot.sequence) &&
              seen.get(snapshot.sequence) !== serialized
            )
              throw new Error('Conflicting coverage sequence')
            seen.set(snapshot.sequence, serialized)
            if (!snapshot.isolate || !snapshot.runId)
              throw new Error('Coverage snapshot has no isolate/run identity')
            const expectedPaths = Object.keys(templates).sort().join('\n')
            if (
              Object.keys(snapshot.metadata).sort().join('\n') !==
                expectedPaths ||
              Object.keys(snapshot.counters).sort().join('\n') !== expectedPaths
            )
              throw new Error(
                'Coverage snapshot lost module metadata or counters',
              )
            const instance = instances.get(snapshot.isolate) ?? {}
            instances.set(snapshot.isolate, instance)
            for (const [path, counts] of Object.entries(snapshot.counters)) {
              if (
                !templates[path] ||
                JSON.stringify(snapshot.metadata[path]) !==
                  JSON.stringify(metadata[path])
              )
                throw new Error(`Coverage source/map mismatch: ${path}`)
              for (const kind of ['s', 'f', 'b'] as const) {
                if (
                  Object.keys(counts[kind]).sort().join(',') !==
                  Object.keys(templates[path]![kind]).sort().join(',')
                )
                  throw new Error(
                    `Coverage counter shape mismatch: ${path}:${kind}`,
                  )
              }
              for (const kind of ['s', 'f'] as const)
                for (const value of Object.values(counts[kind]))
                  if (!Number.isSafeInteger(value) || value < 0)
                    throw new Error('Invalid coverage count')
              for (const [key, values] of Object.entries(counts.b))
                if (
                  values.length !== templates[path]!.b[key]!.length ||
                  values.some(
                    (value) => !Number.isSafeInteger(value) || value < 0,
                  )
                )
                  throw new Error('Invalid branch counter shape')
              const previous = instance[path]
              if (previous) {
                for (const kind of ['s', 'f'] as const)
                  for (const [key, value] of Object.entries(counts[kind]))
                    if (value < previous[kind][key]!)
                      throw new Error(
                        'Coverage counters reset within an isolate',
                      )
                for (const [key, values] of Object.entries(counts.b))
                  if (
                    values.some(
                      (value, index) => value < previous.b[key]![index]!,
                    )
                  )
                    throw new Error(
                      'Coverage branch counters reset within an isolate',
                    )
              }
              const prior = previous ?? structuredClone(counts)
              for (const kind of ['s', 'f'] as const)
                for (const [key, value] of Object.entries(counts[kind]))
                  prior[kind][key] = Math.max(prior[kind][key] ?? 0, value)
              for (const [key, values] of Object.entries(counts.b))
                prior.b[key] = values.map((value, index) =>
                  Math.max(prior.b[key]?.[index] ?? 0, value),
                )
              instance[path] = prior
            }
          }
          const merged = createCoverageMap(templates)
          for (const instance of instances.values()) {
            const data: CoverageMapData = {}
            for (const [path, counts] of Object.entries(instance))
              data[path] = { ...templates[path]!, ...counts }
            merged.merge(data)
          }
          await writeFile(
            join(directory, 'snapshots.json'),
            JSON.stringify(snapshots),
          )
          await writeFile(
            join(directory, 'coverage-raw.json'),
            JSON.stringify(merged.toJSON()),
          )
          const remapped =
            await createSourceMapStore().transformCoverage(merged)
          await writeFile(
            join(directory, 'coverage-final.json'),
            JSON.stringify(remapped.toJSON()),
          )
          await writeFile(
            join(directory, 'coverage-summary.json'),
            JSON.stringify(
              Object.fromEntries(
                remapped
                  .files()
                  .map((path) => [
                    path,
                    remapped.fileCoverageFor(path).toSummary().toJSON(),
                  ]),
              ),
              null,
              2,
            ),
          )
        })(),
      ])
      await harness.close()
      if (collected[0]?.status === 'rejected') throw collected[0].reason
      console.info('G06 native instrumentation receipt', directory)
    },
  }
}
