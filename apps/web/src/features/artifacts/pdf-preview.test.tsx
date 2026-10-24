import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentArtifact } from './document-artifact'

type Deferred = { resolve: () => void; reject: (error: Error) => void }

const pdf = vi.hoisted(() => {
  const renders: Deferred[] = []
  const destroy = vi.fn(async () => {})
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: () => {
      let deferred!: Deferred
      const promise = new Promise<void>((resolve, reject) => {
        deferred = { resolve, reject }
      })
      renders.push(deferred)
      return {
        promise,
        cancel: () => deferred.reject(new Error('cancelled')),
      }
    },
    streamTextContent: () => ({}),
  }
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: async () => page,
    }),
    destroy,
  }))
  return { renders, destroy, getDocument }
})

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.getDocument,
  TextLayer: class {
    render = async () => {}
  },
}))

const DATA = {
  kind: 'document' as const,
  filename: 'report.pdf',
  mediaType: 'application/pdf',
  url: '/files/report.pdf',
}

function ui(refreshKey: number) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <DocumentArtifact data={DATA} refreshKey={refreshKey} />
    </QueryClientProvider>
  )
}

/** Resolves every pending page render until the preview settles. */
async function finishRenders() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      for (const deferred of pdf.renders.splice(0)) deferred.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const pageCount = (container: HTMLElement) =>
  container.querySelectorAll('canvas').length

describe('PDF preview', () => {
  beforeEach(() => {
    pdf.renders.length = 0
    pdf.getDocument.mockClear()
    pdf.destroy.mockClear()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(new ArrayBuffer(8)),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as never,
    )
  })
  afterEach(() => vi.restoreAllMocks())

  it('does not duplicate pages when a reload starts mid-render', async () => {
    const { container, rerender } = render(ui(1))
    await vi.waitFor(() => expect(pdf.renders.length).toBe(1))

    rerender(ui(2))
    await finishRenders()

    expect(pageCount(container)).toBe(2)
    expect(screen.getByText('1/2')).toBeInTheDocument()
    // The superseded document was released.
    expect(pdf.destroy).toHaveBeenCalledTimes(1)
  })

  it('zooms without downloading the document again, and releases it on unmount', async () => {
    const { container, unmount } = render(ui(1))
    await finishRenders()
    expect(pageCount(container)).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await finishRenders()

    expect(pageCount(container)).toBe(2)
    expect(pdf.getDocument).toHaveBeenCalledTimes(1)
    expect(pdf.destroy).not.toHaveBeenCalled()

    unmount()
    expect(pdf.destroy).toHaveBeenCalledTimes(1)
  })
})
