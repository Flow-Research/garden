import { describe, expect, it } from 'vitest'
import { Result } from 'better-result'

import { SandboxProbeError, describeSandboxProbe } from './sandbox-debug'

describe('sandbox debug helpers', () => {
  it('reports sandbox probe failures without throwing', async () => {
    const probe = describeSandboxProbe(
      Result.err(
        new SandboxProbeError({
          command: 'ls -la /workspace 2>/dev/null || ls -la .',
          sessionId: 'thread-123',
          cause: new Error(
            'sandbox offline for ls -la /workspace 2>/dev/null || ls -la .',
          ),
        }),
      ) as Result<any, SandboxProbeError>,
    )

    expect(probe.success).toBe(false)
    expect(probe.stdout).toBe('')
    expect(probe.exitCode).toBe(1)
    expect(probe.stderr).toContain(
      'sandbox offline for ls -la /workspace 2>/dev/null || ls -la .',
    )
  })
})
