import { create } from 'zustand'
import type { AutomationExecutionConfig } from '@garden/core/automations/templates'
import type { TriggerConfig } from './trigger-config'
import { getDefaultTriggerConfig } from './trigger-config'

export type AutomationDraftTemplate = {
  title: string
  prompt: string
  frequency: TriggerConfig['frequency']
  time: string
  systemPrompt?: string
  executionConfig?: AutomationExecutionConfig
  outputConfig?: unknown
  category?: string
  tags?: string[]
  templateSource?: string
}

type AutomationDraftState = {
  title: string
  description: string
  assigneeId: string
  triggerConfig: TriggerConfig
  selectedTemplate: AutomationDraftTemplate | null
  selectedSkillSlugs: string[]
  selectedConnectorIds: string[]
  selectedToolNames: string[]
  templateOpen: boolean
  skillsOpen: boolean
  capabilitiesOpen: boolean
  setTitle: (title: string) => void
  setDescription: (description: string) => void
  setAssigneeId: (assigneeId: string) => void
  setTriggerConfig: (triggerConfig: TriggerConfig) => void
  setTemplateOpen: (open: boolean) => void
  setSkillsOpen: (open: boolean) => void
  setCapabilitiesOpen: (open: boolean) => void
  toggleSkillSlug: (slug: string) => void
  toggleToolName: (toolName: string) => void
  toggleConnectorId: (connectorId: string) => void
  applyTemplate: (template: AutomationDraftTemplate | null) => void
  reset: () => void
}

function toggle(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function templateConnectorDefaults(template: AutomationDraftTemplate | null) {
  return template?.executionConfig?.requiredConnectors ?? []
}

export const useCreateAutomationDialogStore = create<AutomationDraftState>(
  (set) => ({
    title: '',
    description: '',
    assigneeId: '',
    triggerConfig: getDefaultTriggerConfig(),
    selectedTemplate: null,
    selectedSkillSlugs: [],
    selectedConnectorIds: [],
    selectedToolNames: [],
    templateOpen: false,
    skillsOpen: false,
    capabilitiesOpen: false,
    setTitle: (title) => set({ title }),
    setDescription: (description) => set({ description }),
    setAssigneeId: (assigneeId) => set({ assigneeId }),
    setTriggerConfig: (triggerConfig) => set({ triggerConfig }),
    setTemplateOpen: (templateOpen) => set({ templateOpen }),
    setSkillsOpen: (skillsOpen) => set({ skillsOpen }),
    setCapabilitiesOpen: (capabilitiesOpen) => set({ capabilitiesOpen }),
    toggleSkillSlug: (slug) =>
      set((state) => ({ selectedSkillSlugs: toggle(state.selectedSkillSlugs, slug) })),
    toggleToolName: (toolName) =>
      set((state) => ({ selectedToolNames: toggle(state.selectedToolNames, toolName) })),
    toggleConnectorId: (connectorId) =>
      set((state) => ({
        selectedConnectorIds: toggle(state.selectedConnectorIds, connectorId),
      })),
    applyTemplate: (template) =>
      set({
        selectedTemplate: template,
        title: template?.title ?? '',
        description: template?.prompt ?? '',
        triggerConfig: template
          ? {
              ...getDefaultTriggerConfig(),
              frequency: template.frequency,
              time: template.time,
            }
          : getDefaultTriggerConfig(),
        selectedSkillSlugs: template?.executionConfig?.requiredSkills ?? [],
        selectedConnectorIds: templateConnectorDefaults(template),
        selectedToolNames: [],
      }),
    reset: () =>
      set({
        title: '',
        description: '',
        assigneeId: '',
        triggerConfig: getDefaultTriggerConfig(),
        selectedTemplate: null,
        selectedSkillSlugs: [],
        selectedConnectorIds: [],
        selectedToolNames: [],
        templateOpen: false,
        skillsOpen: false,
        capabilitiesOpen: false,
      }),
  }),
)
