import { describe, expect, it } from 'vitest'
import { buildSelectedDocumentsContext } from './document-selection'

describe('existing thread document selection', () => {
  it('preserves document and version identity in turn context', () => {
    expect(
      buildSelectedDocumentsContext([
        {
          documentId: 'document-1',
          filename: 'Research brief.docx',
          versionId: 'version-3',
          versionNumber: 3,
        },
      ]),
    ).toContain(
      'handle: document-1; filename: Research brief.docx (V3); selected_version: version-3',
    )
  })

  it('returns no context when nothing is selected', () => {
    expect(buildSelectedDocumentsContext([])).toBe('')
  })
})
