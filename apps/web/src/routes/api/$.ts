import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  documentArtifactsApiWebHandler,
  makeDocumentArtifactsRequestContext,
} from '@/lib/server/document-artifacts-api.server'

/** Thin TanStack Start host for the Effect HttpApi document application. */
const handleDocumentsApi = async ({
  context,
  request,
}: {
  context: Parameters<typeof requireAppRequestContext>[0]
  request: Request
}) => {
  const appContext = requireAppRequestContext(context)
  const effectContext = await makeDocumentArtifactsRequestContext(appContext)
  return documentArtifactsApiWebHandler(request, effectContext)
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handleDocumentsApi,
      POST: handleDocumentsApi,
      OPTIONS: handleDocumentsApi,
    },
  },
})
