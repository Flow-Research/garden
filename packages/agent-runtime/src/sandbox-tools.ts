import type { Sandbox as SandboxDO } from '@cloudflare/sandbox'
import { tool, type ToolSet } from 'ai'
import { Result, TaggedError } from 'better-result'
import { z } from 'zod'

type SandboxProvider = () => SandboxDO
type SandboxOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; operation: string }

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 24_000
const DEFAULT_CWD = '/workspace'

class SandboxToolError extends TaggedError('SandboxToolError')<{
  operation: string
  message: string
  cause: unknown
}>() {
  constructor(args: { operation: string; cause: unknown }) {
    const detail =
      args.cause instanceof Error ? args.cause.message : String(args.cause)
    super({
      operation: args.operation,
      message: `Sandbox ${args.operation} failed: ${detail}`,
      cause: args.cause,
    })
  }
}

function clampTimeout(timeoutMs: number | undefined) {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.min(
    Math.max(Math.trunc(timeoutMs ?? DEFAULT_TIMEOUT_MS), 1),
    MAX_TIMEOUT_MS,
  )
}

function truncate(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) return value
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated ${value.length - MAX_OUTPUT_CHARS} chars]`
}

function resolveWorkspacePath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '.') return DEFAULT_CWD

  const raw = trimmed.startsWith(DEFAULT_CWD)
    ? trimmed.slice(DEFAULT_CWD.length)
    : trimmed
  const segments = raw
    .replace(/^\.?\//, '')
    .split('/')
    .filter((segment) => segment && segment !== '.')

  const stack: string[] = []
  for (const segment of segments) {
    if (segment === '..') {
      stack.pop()
    } else {
      stack.push(segment)
    }
  }

  return stack.length > 0 ? `${DEFAULT_CWD}/${stack.join('/')}` : DEFAULT_CWD
}

async function runSandboxOperation<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<SandboxOperationResult<T>> {
  const result = (await Result.tryPromise({
    try: run,
    catch: (cause) => new SandboxToolError({ operation, cause }),
  })) as Result<T, SandboxToolError>

  if (result.isErr()) {
    console.warn('[agent-runtime] sandbox operation failed', {
      operation: result.error.operation,
      message: result.error.message,
    })

    return {
      ok: false,
      error: result.error.message,
      operation: result.error.operation,
    }
  }

  return { ok: true, value: result.value }
}

/**
 * Returns a preview URL for a sandbox service. Cloudflare Sandbox 0.10.2
 * added zero-config quick tunnels behind the RPC transport, so Garden can stop
 * requiring callers to know or supply a custom hostname for previewable work.
 */
async function exposeSandboxPreview(
  sandbox: SandboxDO,
  port: number,
  hostname: string | undefined,
) {
  if (hostname) {
    const exposed = await sandbox.exposePort(port, { hostname })
    return {
      hostname,
      port: exposed.port,
      tunnel: false,
      url: exposed.url,
    }
  }

  const tunnel = await sandbox.tunnels.get(port)
  return {
    hostname: tunnel.hostname,
    port: tunnel.port,
    tunnel: true,
    url: tunnel.url,
  }
}

export function createSandboxTools(getSandbox: SandboxProvider): ToolSet {
  return {
    sandboxExec: tool({
      description:
        'Run a shell command inside the persistent sandbox workspace. ' +
        'Use this for one-off scripts, tests, package installs, build commands, and inspecting files. ' +
        'Commands run in /workspace by default. Shell state is not guaranteed between calls, so pass cwd instead of depending on cd.',
      inputSchema: z.object({
        command: z.string().min(1).describe('Shell command to run'),
        cwd: z
          .string()
          .optional()
          .describe(
            'Working directory inside the sandbox, defaults to /workspace',
          ),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(MAX_TIMEOUT_MS)
          .optional()
          .describe('Command timeout in milliseconds'),
      }),
      execute: async ({ command, cwd, timeoutMs }) => {
        const result = await runSandboxOperation('exec', () =>
          getSandbox().exec(command, {
            cwd: resolveWorkspacePath(cwd ?? DEFAULT_CWD),
            timeout: clampTimeout(timeoutMs),
          }),
        )
        if (!result.ok) return result

        return {
          ok: true,
          success: result.value.success,
          exitCode: result.value.exitCode,
          command: result.value.command,
          stdout: truncate(result.value.stdout),
          stderr: truncate(result.value.stderr),
        }
      },
    }),

    sandboxRunCode: tool({
      description:
        'Run Python, JavaScript, or TypeScript code inside the sandbox interpreter. ' +
        'Use this for data/document processing, quick calculations, and short snippets that benefit from structured interpreter results. Prefer sandboxExec for scripts that should be saved as artifacts.',
      inputSchema: z.object({
        code: z.string().min(1).describe('Code to execute'),
        language: z
          .enum(['python', 'javascript', 'typescript'])
          .default('python')
          .describe('Interpreter language'),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(MAX_TIMEOUT_MS)
          .optional()
          .describe('Execution timeout in milliseconds'),
      }),
      execute: async ({ code, language, timeoutMs }) => {
        const result = await runSandboxOperation('runCode', () =>
          getSandbox().runCode(code, {
            language,
            timeout: clampTimeout(timeoutMs),
          }),
        )
        if (!result.ok) return result

        return {
          ok: true,
          logs: {
            stdout: result.value.logs.stdout.map(truncate),
            stderr: result.value.logs.stderr.map(truncate),
          },
          error: result.value.error ?? null,
          results: result.value.results,
          executionCount: result.value.executionCount ?? null,
        }
      },
    }),

    sandboxReadFile: tool({
      description:
        'Read a UTF-8 file from the sandbox workspace. Paths are scoped to /workspace.',
      inputSchema: z.object({
        path: z.string().min(1).describe('File path under /workspace'),
      }),
      execute: async ({ path }) => {
        const result = await runSandboxOperation('readFile', () =>
          getSandbox().readFile(resolveWorkspacePath(path), {
            encoding: 'utf-8',
          }),
        )
        if (!result.ok) return result

        return {
          ok: true,
          path: result.value.path,
          content: truncate(result.value.content),
          size: result.value.size ?? result.value.content.length,
          mimeType: result.value.mimeType ?? null,
          isBinary: result.value.isBinary ?? false,
        }
      },
    }),

    sandboxWriteFile: tool({
      description:
        'Write a UTF-8 file into the sandbox workspace, creating or replacing the file. Use clear paths under /workspace; use /workspace/.scratch for temporary working files.',
      inputSchema: z.object({
        path: z.string().min(1).describe('File path under /workspace'),
        content: z.string().describe('UTF-8 file content'),
      }),
      execute: async ({ path, content }) => {
        const result = await runSandboxOperation('writeFile', () =>
          getSandbox().writeFile(resolveWorkspacePath(path), content, {
            encoding: 'utf-8',
          }),
        )
        if (!result.ok) return result

        return {
          ok: true,
          success: result.value.success,
          path: result.value.path,
        }
      },
    }),

    sandboxListFiles: tool({
      description:
        'List files in the sandbox workspace. Paths are scoped to /workspace.',
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe('Directory path under /workspace, defaults to /workspace'),
        recursive: z.boolean().optional().describe('List recursively'),
        includeHidden: z.boolean().optional().describe('Include hidden files'),
      }),
      execute: async ({ path, recursive, includeHidden }) => {
        const result = await runSandboxOperation('listFiles', () =>
          getSandbox().listFiles(resolveWorkspacePath(path ?? DEFAULT_CWD), {
            recursive,
            includeHidden,
          }),
        )
        if (!result.ok) return result

        return {
          ok: true,
          path: result.value.path,
          count: result.value.count,
          files: result.value.files.slice(0, 500),
          truncated: result.value.files.length > 500,
        }
      },
    }),

    sandboxStartProcess: tool({
      description:
        'Start a long-running process inside the sandbox, such as a dev server. ' +
        'Use sandboxListProcesses and sandboxKillProcess to manage it, and expose the port when the user should inspect the result.',
      inputSchema: z.object({
        command: z.string().min(1).describe('Process command to start'),
        cwd: z
          .string()
          .optional()
          .describe(
            'Working directory inside the sandbox, defaults to /workspace',
          ),
      }),
      execute: async ({ command, cwd }) => {
        const result = await runSandboxOperation('startProcess', () =>
          getSandbox().startProcess(command, {
            cwd: resolveWorkspacePath(cwd ?? DEFAULT_CWD),
          }),
        )
        if (!result.ok) return result

        return {
          ok: true,
          id: result.value.id,
          command: result.value.command,
          status: result.value.status,
          pid: result.value.pid ?? null,
          startTime: result.value.startTime ?? null,
        }
      },
    }),

    sandboxListProcesses: tool({
      description:
        'List running and recently completed processes inside the sandbox.',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await runSandboxOperation('listProcesses', () =>
          getSandbox().listProcesses(),
        )
        if (!result.ok) return result

        return {
          ok: true,
          processes: result.value.map((process) => ({
            id: process.id,
            command: process.command,
            status: process.status,
            pid: process.pid ?? null,
            startTime: process.startTime ?? null,
          })),
        }
      },
    }),

    sandboxKillProcess: tool({
      description: 'Terminate a process that was started inside the sandbox.',
      inputSchema: z.object({
        processId: z
          .string()
          .min(1)
          .describe('Sandbox process id to terminate'),
      }),
      execute: async ({ processId }) => {
        const result = await runSandboxOperation('killProcess', async () => {
          await getSandbox().killProcess(processId)
          return { processId }
        })
        if (!result.ok) return result

        return {
          ok: true,
          processId: result.value.processId,
        }
      },
    }),

    sandboxExposePort: tool({
      description:
        'Expose a service running inside the sandbox and return its preview URL. ' +
        'Use this after starting a web server process for an HTML app, generated artifact, or previewable tool. ' +
        'Omit hostname to use a zero-config Cloudflare quick tunnel.',
      inputSchema: z.object({
        port: z
          .number()
          .int()
          .positive()
          .max(65_535)
          .describe('Port to expose'),
        hostname: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional custom hostname used to generate preview URLs. Omit to create a trycloudflare.com quick tunnel.',
          ),
      }),
      execute: async ({ port, hostname }) => {
        const result = await runSandboxOperation('exposePort', () =>
          exposeSandboxPreview(getSandbox(), port, hostname),
        )
        if (!result.ok) return result

        return {
          ok: true,
          hostname: result.value.hostname,
          port: result.value.port,
          tunnel: result.value.tunnel,
          url: result.value.url,
        }
      },
    }),
  }
}
