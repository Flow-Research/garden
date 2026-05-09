import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { schema } from '@/lib/server/db'
import { getChatDocumentAccess } from '@/lib/server/document-access'

export const Route = createFileRoute('/api/documents/$id/metadata')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const routeParams = params as { id: string }
        const access = await getChatDocumentAccess(request, routeParams.id)
        if (access instanceof Response) return access

        const [row] = await access.db
          .select({
            id: schema.document.id,
            filename: schema.document.filename,
            fileType: schema.document.fileType,
            sizeBytes: schema.document.sizeBytes,
            pageCount: schema.document.pageCount,
            structureTree: schema.document.structureTree,
            status: schema.document.status,
            updatedAt: schema.document.updatedAt,
          })
          .from(schema.document)
          .where(eq(schema.document.id, routeParams.id))
          .limit(1)

        if (!row) {
          return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
        }

        return Response.json({
          ok: true,
          metadata: {
            id: row.id,
            filename: row.filename,
            file_type: row.fileType,
            size_bytes: row.sizeBytes,
            page_count: row.pageCount,
            structure_tree: row.structureTree,
            status: row.status,
            updated_at: row.updatedAt?.toISOString() ?? null,
          },
        })
      },
    },
  },
})
