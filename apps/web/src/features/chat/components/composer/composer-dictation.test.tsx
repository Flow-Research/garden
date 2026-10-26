import { useState, type ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@garden/app-state/hooks', () => ({
  useWorkspaceId: () => 'ws-1',
  useWorkspaceStore: () => null,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isFetching: false, isError: false }),
  queryOptions: (options: unknown) => options,
}))
// Stands in for the browser speech API: one button starts and stops
// listening, another delivers a phrase.
vi.mock('@/components/ai-elements/speech-input', () => ({
  SpeechInput: ({
    onTranscriptionChange,
    onListeningChange,
  }: {
    children?: ReactNode
    onTranscriptionChange?: (text: string) => void
    onListeningChange?: (listening: boolean) => void
  }) => (
    <div>
      <button type="button" onClick={() => onListeningChange?.(true)}>
        start dictation
      </button>
      <button type="button" onClick={() => onListeningChange?.(false)}>
        stop dictation
      </button>
      <button type="button" onClick={() => onTranscriptionChange?.('hello')}>
        say hello
      </button>
    </div>
  ),
}))

import { Composer } from './composer'

function ControlledComposer() {
  const [value, setValue] = useState('')
  return (
    <Composer
      agentId="a1"
      documents={[]}
      isStreaming={false}
      status="ready"
      input={value}
      onInputChange={setValue}
      onSend={vi.fn().mockResolvedValue(undefined)}
      onStop={vi.fn()}
    />
  )
}

describe('Composer dictation', () => {
  it('keeps listening after the first phrase fills the editor', () => {
    render(<ControlledComposer />)

    fireEvent.click(screen.getByRole('button', { name: 'start dictation' }))
    fireEvent.click(screen.getByRole('button', { name: 'say hello' }))

    expect(screen.getByTestId('composer-input')).toHaveValue('hello')
    // Still mounted, so a second phrase can arrive.
    fireEvent.click(screen.getByRole('button', { name: 'say hello' }))
    expect(screen.getByTestId('composer-input')).toHaveValue('hello hello')

    fireEvent.click(screen.getByRole('button', { name: 'stop dictation' }))
    // With text in the editor and dictation over, the mic gives way.
    expect(screen.queryByRole('button', { name: 'say hello' })).toBeNull()
  })
})
