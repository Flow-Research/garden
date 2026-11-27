import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { OPEN_STATUSES } from '@garden/core/issues/config'
import { openIssuesCondition } from './issue-list-filters'

const dialect = new PgDialect()

describe('openIssuesCondition', () => {
  it('matches only open statuses, excluding done and cancelled', () => {
    const query = dialect.sqlToQuery(openIssuesCondition())
    expect(query.sql).toMatch(/"status" in \(/)
    expect(query.params).toEqual([...OPEN_STATUSES])
    expect(query.params).not.toContain('cancelled')
    expect(query.params).not.toContain('done')
  })
})
