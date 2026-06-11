import { createServerFn } from '@tanstack/react-start'
import { queryOptions } from '@tanstack/react-query'
import { requireAppRequestContext } from '@/lib/server/context'
import { z } from 'zod'
import {
  getDashboardActivitySnapshot,
  getDashboardDistributionSnapshot,
  getDashboardOverviewSnapshot,
  getDashboardResourcesSnapshot,
} from './dashboard.server'

const dashboardInputSchema = z.object({
  workspaceId: z.string().min(1),
})

export const dashboardKeys = {
  all: (workspaceId: string) => ['dashboard', workspaceId] as const,
  overview: (workspaceId: string) =>
    [...dashboardKeys.all(workspaceId), 'overview'] as const,
  distribution: (workspaceId: string) =>
    [...dashboardKeys.all(workspaceId), 'distribution'] as const,
  activity: (workspaceId: string) =>
    [...dashboardKeys.all(workspaceId), 'activity'] as const,
  resources: (workspaceId: string) =>
    [...dashboardKeys.all(workspaceId), 'resources'] as const,
}

const getDashboardOverview = createServerFn({ method: 'GET' })
  .inputValidator(dashboardInputSchema)
  .handler(async ({ context, data }) =>
    getDashboardOverviewSnapshot(
      requireAppRequestContext(context),
      data.workspaceId,
    ),
  )

const getDashboardDistribution = createServerFn({ method: 'GET' })
  .inputValidator(dashboardInputSchema)
  .handler(async ({ context, data }) =>
    getDashboardDistributionSnapshot(
      requireAppRequestContext(context),
      data.workspaceId,
    ),
  )

const getDashboardActivity = createServerFn({ method: 'GET' })
  .inputValidator(dashboardInputSchema)
  .handler(async ({ context, data }) =>
    getDashboardActivitySnapshot(
      requireAppRequestContext(context),
      data.workspaceId,
    ),
  )

const getDashboardResources = createServerFn({ method: 'GET' })
  .inputValidator(dashboardInputSchema)
  .handler(async ({ context, data }) =>
    getDashboardResourcesSnapshot(
      requireAppRequestContext(context),
      data.workspaceId,
    ),
  )

export function dashboardOverviewOptions(workspaceId: string) {
  return queryOptions({
    queryKey: dashboardKeys.overview(workspaceId),
    queryFn: () => getDashboardOverview({ data: { workspaceId } }),
    staleTime: 20_000,
  })
}

export function dashboardDistributionOptions(workspaceId: string) {
  return queryOptions({
    queryKey: dashboardKeys.distribution(workspaceId),
    queryFn: () => getDashboardDistribution({ data: { workspaceId } }),
    staleTime: 20_000,
  })
}

export function dashboardActivityOptions(workspaceId: string) {
  return queryOptions({
    queryKey: dashboardKeys.activity(workspaceId),
    queryFn: () => getDashboardActivity({ data: { workspaceId } }),
    staleTime: 20_000,
  })
}

export function dashboardResourcesOptions(workspaceId: string) {
  return queryOptions({
    queryKey: dashboardKeys.resources(workspaceId),
    queryFn: () => getDashboardResources({ data: { workspaceId } }),
    staleTime: 20_000,
  })
}
