import { describe, expect, it } from 'vitest'
import {
  departmentInsertSchema,
  departmentMemberInsertSchema,
  departmentMemberUpdateSchema,
  departmentUpdateSchema,
} from '../validation/index.js'

const ids = {
  workspace: '10000000-0000-4000-8000-000000000001',
  department: '20000000-0000-4000-8000-000000000001',
  member: '30000000-0000-4000-8000-000000000001',
}

describe('department validation', () => {
  it('accepts and trims a valid department creation payload', () => {
    expect(
      departmentInsertSchema.parse({
        workspaceId: ids.workspace,
        name: ' Engineering ',
        slug: ' engineering ',
      }),
    ).toEqual({
      workspaceId: ids.workspace,
      name: 'Engineering',
      slug: 'engineering',
    })
  })

  it('rejects identity and workspace fields in department updates', () => {
    expect(
      departmentUpdateSchema.safeParse({
        id: ids.department,
        name: 'Engineering',
      }).success,
    ).toBe(false)

    expect(
      departmentUpdateSchema.safeParse({
        workspaceId: ids.workspace,
        name: 'Engineering',
      }).success,
    ).toBe(false)

    expect(
      departmentUpdateSchema.safeParse({
        name: 'Engineering',
      }).success,
    ).toBe(true)
  })

  it('accepts a valid department membership payload', () => {
    expect(
      departmentMemberInsertSchema.safeParse({
        workspaceId: ids.workspace,
        departmentId: ids.department,
        memberId: ids.member,
        role: 'lead',
      }).success,
    ).toBe(true)
  })

  it('rejects unsupported department roles', () => {
    expect(
      departmentMemberInsertSchema.safeParse({
        workspaceId: ids.workspace,
        departmentId: ids.department,
        memberId: ids.member,
        role: 'owner',
      }).success,
    ).toBe(false)
  })

  it('only accepts a role in membership update payloads', () => {
    expect(
      departmentMemberUpdateSchema.safeParse({
        role: 'admin',
      }).success,
    ).toBe(true)

    expect(departmentMemberUpdateSchema.safeParse({}).success).toBe(false)

    expect(
      departmentMemberUpdateSchema.safeParse({
        memberId: ids.member,
        role: 'admin',
      }).success,
    ).toBe(false)
  })
})
