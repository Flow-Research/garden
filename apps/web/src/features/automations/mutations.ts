import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { api } from '@/lib/api'
import type {
  CreateAutomationRequest,
  CreateAutomationTriggerRequest,
  UpdateAutomationRequest,
  UpdateAutomationTriggerRequest,
} from '@/lib/api'
import { automationKeys } from './queries'

export function useCreateAutomation() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: (data: CreateAutomationRequest) => api.createAutomation(data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: automationKeys.list(wsId) })
    },
  })
}

export function useUpdateAutomation() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateAutomationRequest) =>
      api.updateAutomation(id, data),
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({ queryKey: automationKeys.list(wsId) })
      qc.invalidateQueries({ queryKey: automationKeys.detail(wsId, vars.id) })
    },
  })
}

export function useDeleteAutomation() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: (id: string) => api.deleteAutomation(id),
    onSettled: (_data, _error, id) => {
      qc.invalidateQueries({ queryKey: automationKeys.list(wsId) })
      qc.removeQueries({ queryKey: automationKeys.detail(wsId, id) })
    },
  })
}

export function useTriggerAutomation() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: (id: string) => api.triggerAutomation(id),
    onSettled: (_data, _error, id) => {
      qc.invalidateQueries({ queryKey: automationKeys.detail(wsId, id) })
      qc.invalidateQueries({
        queryKey: [...automationKeys.detail(wsId, id), 'runs'],
      })
    },
  })
}

export function useCreateAutomationTrigger() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({
      automationId,
      ...data
    }: { automationId: string } & CreateAutomationTriggerRequest) =>
      api.createAutomationTrigger(automationId, data),
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({
        queryKey: automationKeys.detail(wsId, vars.automationId),
      })
    },
  })
}

export function useUpdateAutomationTrigger() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({
      automationId,
      triggerId,
      ...data
    }: {
      automationId: string
      triggerId: string
    } & UpdateAutomationTriggerRequest) =>
      api.updateAutomationTrigger(automationId, triggerId, data),
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({
        queryKey: automationKeys.detail(wsId, vars.automationId),
      })
    },
  })
}

export function useDeleteAutomationTrigger() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({
      automationId,
      triggerId,
    }: {
      automationId: string
      triggerId: string
    }) => api.deleteAutomationTrigger(automationId, triggerId),
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({
        queryKey: automationKeys.detail(wsId, vars.automationId),
      })
    },
  })
}
