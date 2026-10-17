import { describe, expect, it } from 'vitest'
import { updateWorkspaceMemberBodySchema } from './workspaces'

describe('updateWorkspaceMemberBodySchema github identity', () => {
  it('accepts a linked pair and an unlink pair', () => {
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: '123',
        github_login: 'octocat',
      }).success,
    ).toBe(true)
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: null,
        github_login: null,
      }).success,
    ).toBe(true)
  })

  it('rejects mismatched or half-set github fields', () => {
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: '123',
      }).success,
    ).toBe(false)
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: '123',
        github_login: null,
      }).success,
    ).toBe(false)
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_login: 'octocat',
      }).success,
    ).toBe(false)
  })

  it('rejects invalid github login or id shapes', () => {
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: 'abc',
        github_login: 'octocat',
      }).success,
    ).toBe(false)
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: '1',
        github_login: '-bad',
      }).success,
    ).toBe(false)
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: '',
        github_login: 'octocat',
      }).success,
    ).toBe(false)
    expect(
      updateWorkspaceMemberBodySchema.safeParse({
        github_user_id: '1',
        github_login: '',
      }).success,
    ).toBe(false)
  })
})
