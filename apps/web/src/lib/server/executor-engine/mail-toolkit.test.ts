import { describe, expect, it } from 'vitest'
import { matchPattern } from '@executor-js/sdk/core'
import {
  GARDEN_MAIL_EXECUTOR_READ_TOOLS,
  GARDEN_MAIL_EXECUTOR_WRITE_TOOLS,
  gardenMailApprovalTarget,
  gardenMailThreadMutation,
  gardenMailExecutorConnectionPattern,
  resolveGardenMailExecutorPolicy,
  isGardenMailExecutorConnectionName,
  isGardenMailExecutorToolkit,
} from './mail-toolkit'

describe('Garden Mail Executor toolkit', () => {
  it('binds Gmail but never the unrelated Calendar connection', () => {
    expect(
      matchPattern(
        gardenMailExecutorConnectionPattern('gmail'),
        'google_gmail.user.gmail.gmail.users.getProfile',
      ),
    ).toBe(true)
    expect(
      matchPattern(
        gardenMailExecutorConnectionPattern('gmail'),
        'google_calendar.user.googleCalendar.calendar.events.list',
      ),
    ).toBe(false)
    expect(
      matchPattern(
        gardenMailExecutorConnectionPattern('gmail'),
        'google_gmail.user.work.gmail.users.threads.get',
      ),
    ).toBe(false)
  })

  it('rejects wildcard connection names and recognizes per-facet toolkits', () => {
    expect(isGardenMailExecutorConnectionName('*')).toBe(false)
    expect(isGardenMailExecutorConnectionName('gmail_personal')).toBe(true)
    expect(
      isGardenMailExecutorToolkit(
        'garden-mail-174e67d2-bcbc-420b-a1f5-289ee6681b8f',
      ),
    ).toBe(true)
    expect(isGardenMailExecutorToolkit('garden-mail')).toBe(false)
  })

  it('allows useful mail reads and approval-gates provider mutations', () => {
    expect(GARDEN_MAIL_EXECUTOR_READ_TOOLS).toContain('gmail.users.getProfile')
    expect(GARDEN_MAIL_EXECUTOR_READ_TOOLS).toContain(
      'gmail.users.messages.get',
    )
    expect(GARDEN_MAIL_EXECUTOR_READ_TOOLS).toContain('gmail.users.threads.get')
    expect(GARDEN_MAIL_EXECUTOR_WRITE_TOOLS).toContain(
      'gmail.users.threads.modify',
    )
    expect(GARDEN_MAIL_EXECUTOR_WRITE_TOOLS).not.toContain(
      'gmail.users.messages.modify',
    )
    expect(GARDEN_MAIL_EXECUTOR_WRITE_TOOLS).not.toContain(
      'gmail.users.threads.trash',
    )
    expect(GARDEN_MAIL_EXECUTOR_WRITE_TOOLS).not.toContain(
      'gmail.users.threads.untrash',
    )
    expect(GARDEN_MAIL_EXECUTOR_WRITE_TOOLS).not.toContain(
      'gmail.users.messages.delete',
    )
    expect(GARDEN_MAIL_EXECUTOR_READ_TOOLS).not.toContain(
      'gmail.users.drafts.create',
    )
    expect(GARDEN_MAIL_EXECUTOR_READ_TOOLS).not.toContain(
      'gmail.users.drafts.send',
    )
    expect([
      ...GARDEN_MAIL_EXECUTOR_READ_TOOLS,
      ...GARDEN_MAIL_EXECUTOR_WRITE_TOOLS,
    ]).not.toContain('gmail.users.settings.delegates.create')
  })

  it('accepts only exact thread-state label mutations', () => {
    expect(
      gardenMailThreadMutation({
        id: 'thread-1',
        addLabelIds: ['STARRED'],
        removeLabelIds: ['INBOX', 'UNREAD'],
      }),
    ).toEqual({
      threadId: 'thread-1',
      addLabelIds: ['STARRED'],
      removeLabelIds: ['INBOX', 'UNREAD'],
    })
    expect(
      gardenMailThreadMutation({ id: 'thread-1', addLabelIds: ['SPAM'] }),
    ).toBeNull()
    expect(
      gardenMailThreadMutation({
        id: 'thread-1',
        addLabelIds: ['INBOX'],
        removeLabelIds: ['INBOX'],
      }),
    ).toBeNull()
    expect(
      gardenMailThreadMutation({
        id: 'thread-1',
        addLabelIds: ['STARRED'],
        requestBody: {},
      }),
    ).toBeNull()
    expect(gardenMailThreadMutation({ id: 'thread-1' })).toBeNull()
  })

  it('accepts only reversible Gmail mutation approval addresses', () => {
    expect(
      gardenMailApprovalTarget(
        'google_gmail.user.gmail_personal.gmail.users.threads.modify',
      ),
    ).toEqual({
      connectionName: 'gmail_personal',
      toolName: 'gmail.users.threads.modify',
    })
    expect(
      gardenMailApprovalTarget(
        'google_gmail.user.gmail_personal.gmail.users.messages.delete',
      ),
    ).toBeNull()
    expect(
      gardenMailApprovalTarget(
        'google_calendar.user.gmail_personal.calendar.events.delete',
      ),
    ).toBeNull()
  })

  it('resolves exact reads and writes before the broad Gmail block', () => {
    const connections = ['gmail_personal']
    expect(
      resolveGardenMailExecutorPolicy(
        'google_gmail.user.gmail_personal.gmail.users.threads.get',
        connections,
      ),
    ).toBe('approve')
    expect(
      resolveGardenMailExecutorPolicy(
        'google_gmail.user.gmail_personal.gmail.users.threads.modify',
        connections,
      ),
    ).toBe('require_approval')
    expect(
      resolveGardenMailExecutorPolicy(
        'google_gmail.user.gmail_personal.gmail.users.messages.delete',
        connections,
      ),
    ).toBe('block')
    expect(
      resolveGardenMailExecutorPolicy(
        'google_calendar.user.calendar.calendar.events.list',
        connections,
      ),
    ).toBe('block')
  })
})
