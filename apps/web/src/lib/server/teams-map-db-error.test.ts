import { describe, expect, it } from 'vitest'
import { mapDbError } from './teams'

/**
 * #155: FK mapping must key off constraint names. Before the fix, any `23503`
 * became `INVALID_TEAM_MEMBER`, including the issue→team delete race.
 */
describe('mapDbError', () => {
  it('maps the issue→team FK to TEAM_HAS_ISSUES', () => {
    const error = mapDbError({
      code: '23503',
      constraint: 'issue_team_workspace_fk',
    })
    expect(error.code).toBe('TEAM_HAS_ISSUES')
    expect(error.status).toBe(409)
    expect(error.message).toBe('Team has linked issues')
  })

  it.each([
    'team_member_user_id_user_id_fk',
    'team_member_agent_id_agent_id_fk',
    'team_member_team_workspace_fk',
    'team_member_workspace_id_organization_id_fk',
    'team_member_created_by_user_id_fk',
    'team_owner_user_id_user_id_fk',
    'team_created_by_user_id_fk',
  ])('maps %s to INVALID_TEAM_MEMBER', (constraint) => {
    const error = mapDbError({ code: '23503', constraint })
    expect(error.code).toBe('INVALID_TEAM_MEMBER')
    expect(error.status).toBe(400)
  })

  it('maps member identity check violations to INVALID_TEAM_MEMBER', () => {
    const error = mapDbError({
      code: '23514',
      constraint: 'team_member_identity_check',
    })
    expect(error.code).toBe('INVALID_TEAM_MEMBER')
    expect(error.status).toBe(400)
  })

  it('does not treat unknown foreign keys as invalid members', () => {
    const error = mapDbError({
      code: '23503',
      constraint: 'issue_workspace_id_organization_id_fk',
    })
    expect(error.code).toBe('TEAM_OPERATION_FAILED')
    expect(error.status).toBe(500)
  })

  it('maps name unique violations to TEAM_NAME_EXISTS', () => {
    const error = mapDbError({
      code: '23505',
      constraint: 'team_workspace_name_unique',
    })
    expect(error.code).toBe('TEAM_NAME_EXISTS')
    expect(error.status).toBe(409)
  })
})
