import { describe, expect, it } from 'vitest'
import {
  buildMcpAiToolKey,
  canonicalJsonString,
  defaultTrustLevelForRisk,
  guardedMcpToolDescription,
} from './capabilities'

describe('connector capability helpers', () => {
  it('canonicalizes JSON object keys recursively', () => {
    expect(
      canonicalJsonString({
        z: 1,
        a: [{ b: 2, a: 1 }],
      }),
    ).toBe('{"a":[{"a":1,"b":2}],"z":1}')
  })

  it('maps risk classes to default trust levels', () => {
    expect(defaultTrustLevelForRisk('read')).toBe('auto')
    expect(defaultTrustLevelForRisk('write')).toBe('allow')
    expect(defaultTrustLevelForRisk('send_external')).toBe('ask')
    expect(defaultTrustLevelForRisk(null)).toBe('ask')
  })

  it('builds the MCP AI tool key used by the runtime wrapper', () => {
    expect(buildMcpAiToolKey('google-drive', 'create_file')).toBe(
      'tool_googledrive_create_file',
    )
  })

  it('adds a guardrail description to write-like external tools', () => {
    expect(
      guardedMcpToolDescription({
        connectorId: 'github',
        toolName: 'create_issue_comment',
        description: 'Create a comment.',
      }),
    ).toContain('External github write tool.')
  })
})
