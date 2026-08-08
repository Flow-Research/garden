import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDocumentArtifact } from '@/lib/api/documents'
import { DocumentArtifact } from './document-artifact'

vi.mock('@/lib/api/documents', () => ({
  documentArtifactQueryKey: (documentId: string) => [
    'documents',
    documentId,
    'artifact',
  ],
  getDocumentArtifact: vi.fn(),
}))

vi.mock('./workspace-docs-editor', () => ({
  WorkspaceDocsEditor: ({ documentId }: { documentId: string }) => (
    <div data-testid="workspace-docs-editor">{documentId}</div>
  ),
}))

const document = {
  kind: 'document' as const,
  id: 'document-1',
  filename: 'brief.docx',
  mediaType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  url: '/api/documents/document-1/docx',
}

/** Supplies an isolated query cache so each canonical-load assertion is exact. */
function renderArtifact() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentArtifact data={document} />
    </QueryClientProvider>,
  )
}

describe('DocumentArtifact DOCX authority', () => {
  it('renders canonical DOCX state and labels source bytes honestly', async () => {
    vi.mocked(getDocumentArtifact).mockResolvedValue({
      revision: 1,
      title: 'Brief',
      blocks: [{ id: 'block-1', html: '<p>Canonical</p>', version: 1 }],
      lastModified: 1,
    })

    renderArtifact()

    expect(screen.getByRole('link', { name: 'Original DOCX' })).toHaveAttribute(
      'href',
      document.url,
    )
    expect(
      await screen.findByTestId('workspace-docs-editor'),
    ).toHaveTextContent(document.id)
    expect(getDocumentArtifact).toHaveBeenCalledWith(document.id)
  })

  it('never falls back to rendering source DOCX bytes', async () => {
    vi.mocked(getDocumentArtifact).mockRejectedValue(
      new Error('Canonical artifact missing'),
    )

    const { container } = renderArtifact()

    expect(
      await screen.findByText('Editable document unavailable'),
    ).toBeInTheDocument()
    expect(container.querySelector('.docx-view-container')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })
})
