import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const garden = fileURLToPath(new URL('../', import.meta.url))
const target = resolve(garden, 'packages/core/src/execution-host/generated')
const manifestPath = resolve(target, 'source.json')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = ['host-contract.ts', 'host-auth.ts']

if (process.argv[2] === '--check' && process.argv.length === 3) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const name of [...files, 'LICENSE']) {
    if (hash(readFileSync(resolve(target, name))) !== manifest.files[name]) {
      throw new Error(`Pinned Harnessy contract changed: ${name}`)
    }
  }
  process.stdout.write(
    'Pinned Harnessy host contract bytes match their source manifest.\n',
  )
} else if (process.argv[2] === '--source' && process.argv.length === 4) {
  const source = resolve(process.argv[3])
  const baseRevision = execFileSync(
    '/usr/bin/git',
    ['-C', source, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).trim()
  if (!/^[a-f0-9]{40}$/.test(baseRevision))
    throw new Error('Invalid Harnessy source revision')
  mkdirSync(target, { recursive: true })
  const digests = {}
  for (const name of [...files, 'LICENSE']) {
    const origin =
      name === 'LICENSE'
        ? resolve(source, name)
        : resolve(source, 'packages/harnessy-core/src/engineering', name)
    const bytes = readFileSync(origin)
    writeFileSync(resolve(target, name), bytes)
    digests[name] = hash(bytes)
  }
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        repository: 'https://github.com/Flow-Research/harnessy-v2',
        baseRevision,
        qualification:
          'Reviewed working-tree snapshot. File hashes identify the actual source; baseRevision alone does not.',
        files: digests,
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(
    'Copied canonical Harnessy host contract. Review the source manifest before committing.\n',
  )
} else {
  throw new Error('Use --check or --source <Harnessy checkout>.')
}
