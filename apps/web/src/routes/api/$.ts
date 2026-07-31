import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  makeSkillsRequestContext,
  skillsApiWebHandler,
} from '@/lib/server/skills-api.server'

/** Thin TanStack Start host for the Effect HttpApi skills application. */
const handleSkillsApi = async ({
  context,
  request,
}: {
  context: Parameters<typeof requireAppRequestContext>[0]
  request: Request
}) => {
  const appContext = requireAppRequestContext(context)
  const effectContext = await makeSkillsRequestContext(appContext)
  return skillsApiWebHandler(request, effectContext)
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handleSkillsApi,
      POST: handleSkillsApi,
      PUT: handleSkillsApi,
      PATCH: handleSkillsApi,
      DELETE: handleSkillsApi,
      OPTIONS: handleSkillsApi,
    },
  },
})
