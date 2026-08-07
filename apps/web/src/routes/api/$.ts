import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  gardenApiWebHandler,
  makeGardenApiRequestContext,
} from '@/lib/server/garden-api.server'

/** Thin TanStack Start host for Garden's combined Effect HttpApi application. */
const handleGardenApi = async ({
  context,
  request,
}: {
  context: Parameters<typeof requireAppRequestContext>[0]
  request: Request
}) => {
  const appContext = requireAppRequestContext(context)
  const effectContext = await makeGardenApiRequestContext(appContext)
  return gardenApiWebHandler(request, effectContext)
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handleGardenApi,
      POST: handleGardenApi,
      PUT: handleGardenApi,
      PATCH: handleGardenApi,
      DELETE: handleGardenApi,
      OPTIONS: handleGardenApi,
    },
  },
})
