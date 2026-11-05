import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { uploadedBriefTask } from '../examples/chat-tasks.ts'
import { decideWorkbookEvidence, gradeChatTask } from './chat-task.ts'

/** Exercises the public grader so date matching still requires every brief fact. */
function checkAnswer(response: string, task = uploadedBriefTask): boolean {
  return gradeChatTask({
    task,
    threadId: 'brief-date-regression',
    response,
    decideAnalysis: decideWorkbookEvidence({
      runId: '',
      observedRunCount: 0,
      status: null,
      fileNames: [],
      inspection: null,
    }),
  }).match({
    ok: (checks) => {
      const answer = checks.find(
        (check) => check.criterionId === 'answer-uses-owner-and-date',
      )
      assert.ok(answer)
      return answer.passed
    },
    err: (error) => assert.fail(error.message),
  })
}

describe('uploaded brief date facts', () => {
  it('accepts the actual answer previously rejected by substring matching', () => {
    assert.equal(
      checkAnswer(
        "Maya Okafor's Lark migration project is set to launch on December 14, 2026.",
      ),
      true,
    )
  })

  for (const date of [
    '2026-12-14',
    '14 December 2026',
    'Dec 14, 2026',
    '14 Dec. 2026',
    'December 14th, 2026',
    '14th December, 2026',
    'DECEMBER\n14,\t2026',
  ]) {
    it(`accepts the equivalent date ${JSON.stringify(date)}`, () => {
      assert.equal(checkAnswer(`Maya Okafor launches Lark on (${date}).`), true)
    })
  }

  for (const date of [
    '2026-12-15',
    'December 15, 2026',
    'December 14, 2027',
    'November 14, 2026',
    'December 140, 2026',
    'December 14, 20260',
    '2026-12-140',
    '12/14/2026',
  ]) {
    it(`rejects an incorrect or unsupported date ${date}`, () => {
      assert.equal(checkAnswer(`Maya Okafor launches Lark on ${date}.`), false)
    })
  }

  it('requires the owner even when the date is correct', () => {
    assert.equal(checkAnswer('Lark launches on December 14, 2026.'), false)
    assert.equal(
      checkAnswer('Maya Smith launches Lark on December 14, 2026.'),
      false,
    )
  })

  it('requires a date even when the owner is correct', () => {
    assert.equal(checkAnswer('Maya Okafor owns Lark.'), false)
    assert.equal(checkAnswer(''), false)
  })

  it('does not guess the interpretation of an ambiguous numeric date', () => {
    const task = {
      ...uploadedBriefTask,
      successCriteria: uploadedBriefTask.successCriteria.map((criterion) =>
        criterion.criterionId === 'answer-uses-owner-and-date'
          ? {
              ...criterion,
              expected: { values: ['Maya Okafor', '2026-04-05'] },
            }
          : criterion,
      ),
    }
    assert.equal(
      checkAnswer('Maya Okafor launches Lark on April 5, 2026.', task),
      true,
    )
    assert.equal(
      checkAnswer('Maya Okafor launches Lark on 04/05/2026.', task),
      false,
    )
  })
})
