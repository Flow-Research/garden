import { describe, expect, it } from 'vitest'
import { mailContentErrorResponse } from './mail-content'

describe('Garden Mail content HTTP errors', () => {
  it.each([
    ['MailRequestUnauthorizedError', 401],
    ['MailRequestForbiddenError', 403],
    ['MailRepositoryAccessDeniedError', 403],
    ['MailRepositoryNotFoundError', 404],
    ['MailObjectNotFoundError', 404],
    ['ParseError', 400],
  ] as const)('maps %s to %s', (tag, status) => {
    expect(mailContentErrorResponse({ _tag: tag })?.status).toBe(status)
  })

  it('leaves unknown defects to the global request-id boundary', () => {
    expect(mailContentErrorResponse(new Error('database failed'))).toBeNull()
  })
})
