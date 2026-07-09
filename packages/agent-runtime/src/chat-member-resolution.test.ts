import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceMember,
  type WorkspaceMemberCandidate,
} from './chat-member-resolution'

const members: WorkspaceMemberCandidate[] = [
  {
    membershipId: '10000000-0000-4000-8000-000000000001',
    userId: '20000000-0000-4000-8000-000000000001',
    name: 'Avery Stone',
    email: 'avery@example.test',
    role: 'owner',
  },
  {
    membershipId: '10000000-0000-4000-8000-000000000002',
    userId: '20000000-0000-4000-8000-000000000002',
    name: 'Morgan Lee',
    email: 'morgan@example.test',
    role: 'admin',
  },
  {
    membershipId: '10000000-0000-4000-8000-000000000003',
    userId: '20000000-0000-4000-8000-000000000003',
    name: 'Avery Research',
    email: 'research@example.test',
    role: 'member',
  },
]

describe('resolveWorkspaceMember', () => {
  it('resolves stable user and membership ids', () => {
    expect(
      resolveWorkspaceMember(
        members,
        '20000000-0000-4000-8000-000000000001',
      ).unwrap().name,
    ).toBe('Avery Stone')
    expect(
      resolveWorkspaceMember(
        members,
        '10000000-0000-4000-8000-000000000002',
      ).unwrap().name,
    ).toBe('Morgan Lee')
  })

  it('resolves exact email and unique natural-name matches', () => {
    expect(
      resolveWorkspaceMember(members, 'MORGAN@EXAMPLE.TEST').unwrap().name,
    ).toBe('Morgan Lee')
    expect(resolveWorkspaceMember(members, 'morgan').unwrap().userId).toBe(
      '20000000-0000-4000-8000-000000000002',
    )
  })

  it('refuses ambiguous names instead of guessing', () => {
    const result = resolveWorkspaceMember(members, 'avery')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain('ambiguous')
  })

  it('explains how to discover valid members when none match', () => {
    const result = resolveWorkspaceMember(members, 'nobody')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain("include:['members']")
  })
})
