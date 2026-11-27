import { resolve } from 'node:path'
import { createViteServer } from 'vitest/node'

const [entryFile, ...entryArgs] = process.argv.slice(2)
if (!entryFile) {
  console.error('Usage: run-vite-module <entry> [...args]')
  process.exit(2)
}

const entry = resolve(process.cwd(), entryFile)
process.argv = [process.argv[0] ?? 'node', entry, ...entryArgs]

const server = await createViteServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'silent',
  root: process.cwd(),
  server: { middlewareMode: true },
})

await server.ssrLoadModule(entry).finally(() => server.close())
