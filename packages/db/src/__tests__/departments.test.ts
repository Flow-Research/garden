import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  department,
  departmentMember,
  member,
  organization,
  user,
} from '../schema/index.js'
import { startTestDb, type TestDb } from '../testing/container.js'

describe('departments (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  /**
   * Creates one workspace and one verified member for department constraint tests.
   */
  async function seedWorkspaceMember(testDb: TestDb, label: string) {
    const userId = randomUUID()
    const workspaceId = randomUUID()

    await testDb.db.insert(user).values({
      id: userId,
      email: `${userId}@example.com`,
      name: `${label} member`,
    })

    await testDb.db.insert(organization).values({
      id: workspaceId,
      name: `${label} workspace`,
      slug: `${label}-${workspaceId}`,
    })

    const [workspaceMember] = await testDb.db
      .insert(member)
      .values({
        organizationId: workspaceId,
        userId,
        role: 'member',
      })
      .returning({ id: member.id })

    if (!workspaceMember) {
      throw new Error('Workspace member fixture was not created')
    }

    return {
      memberId: workspaceMember.id,
      workspaceId,
    }
  }

  it('creates a department and assigns an existing workspace member', async () => {
    const userId = randomUUID()
    const workspaceId = randomUUID()

    await testDb.db.insert(user).values({
      id: userId,
      email: `${userId}@example.com`,
      name: 'Department lead',
    })

    await testDb.db.insert(organization).values({
      id: workspaceId,
      name: 'Department Workspace',
      slug: `department-${workspaceId}`,
    })

    const [workspaceMember] = await testDb.db
      .insert(member)
      .values({
        organizationId: workspaceId,
        userId,
        role: 'member',
      })
      .returning({ id: member.id })

    const [createdDepartment] = await testDb.db
      .insert(department)
      .values({
        workspaceId,
        name: 'Engineering',
        slug: 'engineering',
      })
      .returning()

    if (!workspaceMember || !createdDepartment) {
      throw new Error('Department fixture was not created')
    }

    await testDb.db.insert(departmentMember).values({
      workspaceId,
      departmentId: createdDepartment.id,
      memberId: workspaceMember.id,
      role: 'lead',
    })

    const assignments = await testDb.db
      .select({
        departmentId: departmentMember.departmentId,
        memberId: departmentMember.memberId,
        role: departmentMember.role,
      })
      .from(departmentMember)
      .where(
        and(
          eq(departmentMember.departmentId, createdDepartment.id),
          eq(departmentMember.memberId, workspaceMember.id),
        ),
      )

    expect(assignments).toEqual([
      {
        departmentId: createdDepartment.id,
        memberId: workspaceMember.id,
        role: 'lead',
      },
    ])
  })

  it('rejects cross-workspace department memberships', async () => {
    const engineering = await seedWorkspaceMember(testDb, 'engineering')
    const finance = await seedWorkspaceMember(testDb, 'finance')

    const [engineeringDepartment] = await testDb.db
      .insert(department)
      .values({
        workspaceId: engineering.workspaceId,
        name: 'Platform',
        slug: 'platform',
      })
      .returning({ id: department.id })

    if (!engineeringDepartment) {
      throw new Error('Engineering department fixture was not created')
    }

    const crossWorkspaceAssignment = testDb.db.insert(departmentMember).values({
      workspaceId: engineering.workspaceId,
      departmentId: engineeringDepartment.id,
      memberId: finance.memberId,
      role: 'member',
    })

    await expect(crossWorkspaceAssignment).rejects.toMatchObject({
      cause: {
        constraint: 'department_member_member_workspace_fk',
      },
    })

    const crossWorkspaceDepartmentAssignment = testDb.db
      .insert(departmentMember)
      .values({
        workspaceId: finance.workspaceId,
        departmentId: engineeringDepartment.id,
        memberId: finance.memberId,
        role: 'member',
      })

    await expect(crossWorkspaceDepartmentAssignment).rejects.toMatchObject({
      cause: {
        constraint: 'department_member_department_workspace_fk',
      },
    })
  })

  it('rejects duplicate department membership', async () => {
    const engineering = await seedWorkspaceMember(testDb, 'duplicate')
    const [engineeringDepartment] = await testDb.db
      .insert(department)
      .values({
        workspaceId: engineering.workspaceId,
        name: 'Infrastructure',
        slug: 'infrastructure',
      })
      .returning({ id: department.id })

    if (!engineeringDepartment) {
      throw new Error('Department fixture was not created')
    }

    const assignment = {
      workspaceId: engineering.workspaceId,
      departmentId: engineeringDepartment.id,
      memberId: engineering.memberId,
      role: 'member',
    }

    await testDb.db.insert(departmentMember).values(assignment)

    await expect(
      testDb.db.insert(departmentMember).values(assignment),
    ).rejects.toMatchObject({
      cause: {
        constraint: 'department_member_workspace_department_member_unique',
      },
    })

    const assignments = await testDb.db
      .select({ id: departmentMember.id })
      .from(departmentMember)
      .where(
        and(
          eq(departmentMember.departmentId, engineeringDepartment.id),
          eq(departmentMember.memberId, engineering.memberId),
        ),
      )

    expect(assignments).toHaveLength(1)
  })

  it('rejects unsupported department roles', async () => {
    const engineering = await seedWorkspaceMember(testDb, 'role')
    const [engineeringDepartment] = await testDb.db
      .insert(department)
      .values({
        workspaceId: engineering.workspaceId,
        name: 'Developer Experience',
        slug: 'developer-experience',
      })
      .returning({ id: department.id })

    if (!engineeringDepartment) {
      throw new Error('Department fixture was not created')
    }

    const invalidRoleAssignment = testDb.db.insert(departmentMember).values({
      workspaceId: engineering.workspaceId,
      departmentId: engineeringDepartment.id,
      memberId: engineering.memberId,
      role: 'owner',
    })

    await expect(invalidRoleAssignment).rejects.toMatchObject({
      cause: {
        constraint: 'department_member_role_check',
      },
    })
  })

  it('scopes department slug uniqueness to one workspace', async () => {
    const engineering = await seedWorkspaceMember(testDb, 'slug-engineering')
    const finance = await seedWorkspaceMember(testDb, 'slug-finance')

    await testDb.db.insert(department).values([
      {
        workspaceId: engineering.workspaceId,
        name: 'Engineering Operations',
        slug: 'operations',
      },
      {
        workspaceId: finance.workspaceId,
        name: 'Finance Operations',
        slug: 'operations',
      },
    ])

    const duplicateEngineeringSlug = testDb.db.insert(department).values({
      workspaceId: engineering.workspaceId,
      name: 'Another Engineering Operations',
      slug: 'operations',
    })

    await expect(duplicateEngineeringSlug).rejects.toMatchObject({
      cause: {
        constraint: 'department_workspace_slug_unique',
      },
    })
  })

  it('preserves memberships when a department is archived', async () => {
    const engineering = await seedWorkspaceMember(testDb, 'archive')
    const [engineeringDepartment] = await testDb.db
      .insert(department)
      .values({
        workspaceId: engineering.workspaceId,
        name: 'Quality Assurance',
        slug: 'quality-assurance',
      })
      .returning({ id: department.id })

    if (!engineeringDepartment) {
      throw new Error('Department fixture was not created')
    }

    await testDb.db.insert(departmentMember).values({
      workspaceId: engineering.workspaceId,
      departmentId: engineeringDepartment.id,
      memberId: engineering.memberId,
      role: 'lead',
    })

    const archivedAt = new Date()

    await testDb.db
      .update(department)
      .set({ archivedAt })
      .where(eq(department.id, engineeringDepartment.id))

    const [archivedDepartment] = await testDb.db
      .select({ archivedAt: department.archivedAt })
      .from(department)
      .where(eq(department.id, engineeringDepartment.id))

    const assignments = await testDb.db
      .select({ id: departmentMember.id })
      .from(departmentMember)
      .where(eq(departmentMember.departmentId, engineeringDepartment.id))

    expect(archivedDepartment?.archivedAt).toEqual(archivedAt)
    expect(assignments).toHaveLength(1)
  })
})
