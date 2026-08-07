import { GardenDocumentsApi } from './document-artifact-contract'
import { GardenExecutorApi } from './executor-connectors-contract'
import { GardenSkillsApi } from './skills-contract'

/**
 * Canonical Garden HTTP contract. Skills and document artifacts were first
 * mounted as competing catch-all handlers; composing their contracts gives
 * TanStack one Effect router while preserving independently generated clients.
 */
export const GardenApi =
  GardenSkillsApi.addHttpApi(GardenDocumentsApi).addHttpApi(GardenExecutorApi)
