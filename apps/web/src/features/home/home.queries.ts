import { createServerFn } from '@tanstack/react-start'
import { queryOptions } from '@tanstack/react-query'
import { requireAppRequestContext } from '@/lib/server/context'
import { z } from 'zod'
import { getHomeSnapshot } from './home.server'

const homeInputSchema = z.object({
  workspaceId: z.string().min(1),
})

export const homeKeys = {
  all: (workspaceId: string) => ['home', workspaceId] as const,
  snapshot: (workspaceId: string) =>
    [...homeKeys.all(workspaceId), 'snapshot'] as const,
}

const getHome = createServerFn({ method: 'GET' })
  .inputValidator(homeInputSchema)
  .handler(async ({ context, data }) =>
    getHomeSnapshot(requireAppRequestContext(context), data.workspaceId),
  )

export function homeSnapshotOptions(workspaceId: string) {
  return queryOptions({
    queryKey: homeKeys.snapshot(workspaceId),
    queryFn: () => getHome({ data: { workspaceId } }),
    staleTime: 20_000,
  })
}
