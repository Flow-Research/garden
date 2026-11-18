import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import type * as AgentsSdk from 'agents'

// Bundle the installed SDK with only Cloudflare platform leaves replaced.
// Decorator metadata and browser RPC dispatch remain the installed implementation.
const sdkBundle = await build({
  entryPoints: [fileURLToPath(import.meta.resolve('agents'))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'cloudflare-test-leaves',
      setup(builder) {
        builder.onResolve({ filter: /^cloudflare:/ }, (args) => ({
          path: args.path,
          namespace: 'test-platform',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'test-platform' }, () => ({
          contents:
            'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } } export class RpcTarget {} export class EmailMessage {} export const exports = {}; export const env = {};',
        }))
      },
    },
  ],
})
const sdkModule = { exports: {} }
const sdkOutput = sdkBundle.outputFiles[0]
if (!sdkOutput) throw new Error('SDK bundle output missing')
new Function('require', 'module', 'exports', sdkOutput.text)(
  createRequire(import.meta.url),
  sdkModule,
  sdkModule.exports,
)
export const agentsSdk = sdkModule.exports as typeof AgentsSdk
