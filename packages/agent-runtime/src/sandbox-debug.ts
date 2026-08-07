import { Result, TaggedError } from 'better-result'

export type SandboxExecResult = {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
}

export class SandboxProbeError extends TaggedError('SandboxProbeError')<{
  command: string
  sessionId: string
  message: string
  cause: unknown
}>() {
  constructor(args: { command: string; sessionId: string; cause: unknown }) {
    const detail =
      args.cause instanceof Error ? args.cause.message : String(args.cause)
    super({
      ...args,
      message: `Sandbox probe failed for "${args.command}" in session "${args.sessionId}": ${detail}`,
    })
  }
}

export async function probeSandboxCommand(
  runCommand: (
    command: string,
    sessionId: string,
  ) => Promise<SandboxExecResult>,
  command: string,
  sessionId?: string,
) {
  const normalizedSessionId = sessionId?.trim() || 'default'
  return Result.tryPromise({
    try: () => runCommand(command, normalizedSessionId),
    catch: (cause) =>
      new SandboxProbeError({
        command,
        sessionId: normalizedSessionId,
        cause,
      }),
  })
}

export function describeSandboxProbe(
  result: Result<SandboxExecResult, SandboxProbeError>,
): SandboxExecResult {
  return result.match({
    ok: (value) => value,
    err: (error) => ({
      success: false,
      stdout: '',
      stderr: error.message,
      exitCode: 1,
    }),
  })
}
