import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionCard } from './question-card'

const QUESTION = {
  id: 'q-1',
  question: 'Which environment?',
  options: [{ label: 'Staging' }, { label: 'Production' }],
}

function renderWithEditor(onSubmit = vi.fn()) {
  render(
    <>
      <div contentEditable role="textbox" aria-label="Comment">
        <p>draft</p>
      </div>
      <input aria-label="Title" />
      <QuestionCard question={QUESTION} onSubmit={onSubmit} />
    </>,
  )
  return onSubmit
}

describe('QuestionCard number shortcuts', () => {
  it('answers with the matching option when nothing editable is focused', () => {
    const onSubmit = renderWithEditor()

    fireEvent.keyDown(screen.getByText('Which environment?'), { key: '2' })

    expect(onSubmit).toHaveBeenCalledWith('Production')
  })

  it('ignores digits typed outside the question card', () => {
    const onSubmit = renderWithEditor()

    fireEvent.keyDown(document.body, { key: '2' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores digits typed into a contentEditable editor', () => {
    const onSubmit = renderWithEditor()
    const paragraph = screen.getByText('draft')

    fireEvent.keyDown(paragraph, { key: '2' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores digits typed into an input', () => {
    const onSubmit = renderWithEditor()

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), {
      key: '1',
    })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores held-down key repeats and out-of-range digits', () => {
    const onSubmit = renderWithEditor()

    fireEvent.keyDown(document.body, { key: '1', repeat: true })
    fireEvent.keyDown(document.body, { key: '3' })

    expect(onSubmit).not.toHaveBeenCalled()
  })
})
