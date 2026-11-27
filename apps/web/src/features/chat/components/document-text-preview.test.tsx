import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentViewerDialog } from './chat-document-panel'

function file(url: string) {
  return {
    type: 'file' as const,
    url,
    mediaType: 'text/plain',
    filename: 'notes.txt',
  }
}

function renderViewer(url: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const ui = (fileUrl: string) => (
    <QueryClientProvider client={queryClient}>
      <DocumentViewerDialog file={file(fileUrl)} onClose={vi.fn()} />
    </QueryClientProvider>
  )
  const view = render(ui(url))
  return { rerender: (next: string) => view.rerender(ui(next)) }
}

describe('text document preview', () => {
  afterEach(() => vi.restoreAllMocks())

  it('retries a failed load', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('Meeting notes'))
    renderViewer('/files/notes.txt')

    expect(await screen.findByText('HTTP 500')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Meeting notes')).toBeInTheDocument()
  })

  it('does not show the previous file while the next one loads', async () => {
    let finish: (response: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('First file'))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      )
    const view = renderViewer('/files/first.txt')
    expect(await screen.findByText('First file')).toBeInTheDocument()

    view.rerender('/files/second.txt')
    expect(screen.queryByText('First file')).toBeNull()

    finish(new Response('Second file'))
    expect(await screen.findByText('Second file')).toBeInTheDocument()
  })
})
