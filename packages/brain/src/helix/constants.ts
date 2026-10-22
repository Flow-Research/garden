export const LABELS = {
  File: 'file',
  Section: 'section',
  Note: 'note',
} as const

export const PROPS = {
  tenantId: 'workspace_id',
  kind: 'kind',
  label: 'label',
  summary: 'summary',
  r2Key: 'r2_key',
  sizeBytes: 'size_bytes',
  canonicalType: 'canonical_type',
  canonicalValue: 'canonical_value',
  indexed: 'indexed',
  indexStatus: 'index_status',
  indexError: 'index_error',
  origin: 'origin',
  body: 'body',
  scopeKind: 'scope_kind',
  scopeId: 'scope_id',
  occurredAt: 'occurred_at',
} as const

export const MENTION_PROPS = {
  text: 'mention_text',
  spanStart: 'mention_span_start',
  spanEnd: 'mention_span_end',
} as const

export const VECTOR_PROP = 'embedding'

export const SOURCE_KEY_PROP = 'source_key'

export const EDGES = {
  hasSection: 'HAS_SECTION',
  mentions: 'MENTIONS',
  sameAs: 'SAME_AS',
} as const

export const QUERY = {
  index: 'brain.index',
  read: 'brain.read',
  listFiles: 'brain.list_files',
  ensureIndexes: 'brain.ensure_indexes',
  indexStatus: 'brain.index_status',
  search: 'brain.search',
  textSearch: 'brain.text_search',
  vectorSearch: 'brain.vector_search',
  linkSections: 'brain.link_sections',
  sectionsOf: 'brain.sections_of',
  observeMention: 'brain.observe_mention',
  linkItems: 'brain.link_items',
  updateItemMetadata: 'brain.update_item_metadata',
  updateIndexStatus: 'brain.update_index_status',
  deleteFile: 'brain.delete_file',
  neighborhood: 'brain.neighborhood',
  countNodes: 'brain.count_nodes',
} as const
