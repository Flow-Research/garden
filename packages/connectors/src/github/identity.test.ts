import { describe, expect, it } from 'vitest'
import { resolveGithubToolOwner } from './identity.ts'

const ACCOUNT = 'Flow-Research'

describe('resolveGithubToolOwner', () => {
  it('proceeds untouched when no canonical login is available', () => {
    const input = { owner: 'anything', repo: 'goes' }
    expect(
      resolveGithubToolOwner({
        accountLogin: null,
        input,
        mode: 'write',
      }),
    ).toEqual({ kind: 'proceed', input })
    expect(
      resolveGithubToolOwner({
        accountLogin: '   ',
        input,
        mode: 'write',
      }).kind,
    ).toBe('proceed')
  })

  it('proceeds for inputs without an owner field', () => {
    const input = { page: 1, perPage: 100 }
    expect(
      resolveGithubToolOwner({ accountLogin: ACCOUNT, input, mode: 'write' }),
    ).toEqual({ kind: 'proceed', input })
  })

  it('proceeds for non-object input and non-string owners', () => {
    expect(
      resolveGithubToolOwner({
        accountLogin: ACCOUNT,
        input: 'owner',
        mode: 'write',
      }).kind,
    ).toBe('proceed')
    expect(
      resolveGithubToolOwner({
        accountLogin: ACCOUNT,
        input: null,
        mode: 'write',
      }).kind,
    ).toBe('proceed')
    expect(
      resolveGithubToolOwner({
        accountLogin: ACCOUNT,
        input: { owner: 42, repo: 'garden' },
        mode: 'write',
      }).kind,
    ).toBe('proceed')
    expect(
      resolveGithubToolOwner({
        accountLogin: ACCOUNT,
        input: { owner: '  ', repo: 'garden' },
        mode: 'write',
      }).kind,
    ).toBe('proceed')
  })

  it('proceeds with the same reference on an exact match', () => {
    const input = { owner: ACCOUNT, repo: 'garden' }
    expect(
      resolveGithubToolOwner({ accountLogin: ACCOUNT, input, mode: 'write' }),
    ).toEqual({ kind: 'proceed', input })
  })

  // #332: the model re-cases (or whitespace-pads) the real login. GitHub
  // logins compare case-insensitively, so the call would work, but the
  // canonical casing keeps the request and transcript unambiguous.
  it('corrects a case-variant owner to the canonical login', () => {
    const input = { owner: 'flow-research', repo: 'garden', state: 'open' }
    const gate = resolveGithubToolOwner({
      accountLogin: ACCOUNT,
      input,
      mode: 'write',
    })
    expect(gate).toEqual({
      kind: 'proceed',
      input: { owner: ACCOUNT, repo: 'garden', state: 'open' },
    })
  })

  it('trims surrounding whitespace on the owner before comparing', () => {
    const gate = resolveGithubToolOwner({
      accountLogin: ACCOUNT,
      input: { owner: ` ${ACCOUNT} `, repo: 'garden' },
      mode: 'write',
    })
    expect(gate.kind).toBe('proceed')
    if (gate.kind === 'proceed') {
      expect(gate.input).toEqual({ owner: ACCOUNT, repo: 'garden' })
    }
  })

  // #332: `flowresearch` vs `Flow-Research` is a different string, not just
  // casing — the hallucinated org never reached the right repository and
  // surfaced as 404s until inventory revealed the real login.
  it('rejects an owner that is not the connected account on writes', () => {
    const gate = resolveGithubToolOwner({
      accountLogin: ACCOUNT,
      input: { owner: 'flowresearch', repo: 'garden' },
      mode: 'write',
    })
    expect(gate.kind).toBe('reject')
    if (gate.kind === 'reject') {
      expect(gate.message).toContain('flowresearch')
      expect(gate.message).toContain(ACCOUNT)
      expect(gate.message).toContain('list_repositories')
    }
  })

  // Reads are useful context even on a public repo outside the installation;
  // a read cannot change GitHub state, so the 404 hint owns recovery.
  it('accepts another owner untouched on reads', () => {
    const input = { owner: 'cloudflare', repo: 'agents', ref: 'main' }
    expect(
      resolveGithubToolOwner({ accountLogin: ACCOUNT, input, mode: 'read' }),
    ).toEqual({ kind: 'proceed', input })
  })

  it('still corrects a case-variant owner on reads', () => {
    const gate = resolveGithubToolOwner({
      accountLogin: ACCOUNT,
      input: { owner: ' flow-research ', repo: 'garden' },
      mode: 'read',
    })
    expect(gate).toEqual({
      kind: 'proceed',
      input: { owner: ACCOUNT, repo: 'garden' },
    })
  })

  it('checks a fork destination without changing its external source', () => {
    const input = {
      owner: 'cloudflare',
      repo: 'agents',
      organization: 'flow-research',
    }
    expect(
      resolveGithubToolOwner({
        accountLogin: ACCOUNT,
        input,
        mode: 'write',
        ownerField: 'organization',
      }),
    ).toEqual({ kind: 'proceed', input: { ...input, organization: ACCOUNT } })

    expect(
      resolveGithubToolOwner({
        accountLogin: ACCOUNT,
        input: { owner: 'cloudflare', repo: 'agents' },
        mode: 'write',
        ownerField: 'organization',
      }).kind,
    ).toBe('proceed')

    const rejected = resolveGithubToolOwner({
      accountLogin: ACCOUNT,
      input: { ...input, organization: 'other-org' },
      mode: 'write',
      ownerField: 'organization',
    })
    expect(rejected.kind).toBe('reject')
    if (rejected.kind === 'reject') {
      expect(rejected.message).toContain('organization "Flow-Research"')
    }
  })
})
