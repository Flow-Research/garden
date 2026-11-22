import { crc32 } from 'node:zlib'
import { NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { expect, layer } from '@effect/vitest'
import { ExtractorLive } from '../src/services/Extractor.ts'
import {
  Extractor,
  FileFormat,
  formatOf,
} from '../src/services/ExtractorService.ts'

const wordNamespace =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/**
 * Builds an uncompressed DOCX archive around one `word/document.xml` body, so
 * a test controls the exact XML bytes that Mammoth hands to its XML parser.
 */
function storedDocx(documentXml: string): Uint8Array {
  const parts: ReadonlyArray<readonly [string, string]> = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    ['word/document.xml', documentXml],
  ]
  const entries = parts.map(
    ([name, text]) => [Buffer.from(name), Buffer.from(text)] as const,
  )
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of entries) {
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    local.copy(central, 16, 14, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

const wordDocument = (body: string) =>
  `<?xml version="1.0"?><w:document ${wordNamespace}><w:body>${body}</w:body></w:document>`

const malformedWordDocuments = [
  [
    'a repeated attribute',
    wordDocument(
      `<w:p ${Array.from({ length: 4000 }, (_, index) => `a${index % 7}="x"`).join(' ')}/>`,
    ),
  ],
  [
    'content after an end-tag name',
    wordDocument(`<w:p></w:p${' '.repeat(20_000)}x>`),
  ],
  [
    'unterminated attribute values',
    `<?xml version="1.0"?><w:document ${wordNamespace}><w:body>${'<w:p a="'.repeat(4000)}`,
  ],
] as const

/** Verifies that CSV uploads keep their raw text while using a distinct file
 * format so the Brain ingestion path can accept and index them. */
layer(Layer.provide(ExtractorLive, NodeFileSystem.layer))('extractor', (it) => {
  it.effect('extracts CSV bytes as text with CSV format metadata', () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor
      const csv = 'region,revenue\nNorth,15300\nSouth,12900\n'
      const doc = yield* extractor.extractFromBytes(
        'sales.csv',
        new TextEncoder().encode(csv),
      )

      expect(formatOf('sales.csv')).toBe(FileFormat.Csv)
      expect(doc.format).toBe(FileFormat.Csv)
      expect(doc.body).toBe(csv)
    }),
  )

  it.effect('extracts DOCX text through the installed XML parser', () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor
      const doc = yield* extractor.extractFromBytes(
        'stored.docx',
        storedDocx(wordDocument('<w:p><w:r><w:t>Owner: Ada</w:t></w:r></w:p>')),
      )

      expect(doc.format).toBe(FileFormat.Docx)
      expect(doc.body).toContain('Owner: Ada')
    }),
  )

  for (const [label, documentXml] of malformedWordDocuments) {
    it.effect(`fails DOCX extraction on word XML with ${label}`, () =>
      Effect.gen(function* () {
        const extractor = yield* Extractor
        const failure = yield* extractor
          .extractFromBytes('malformed.docx', storedDocx(documentXml))
          .pipe(Effect.flip)

        expect(failure._tag).toBe('ExtractError')
        expect(failure.message).toBe(
          'failed to extract text from malformed.docx',
        )
      }),
    )
  }
})
