import type {
  CreateSkillRequest,
  Skill,
  SkillPreview,
  SkillsShSearchResult,
  UpdateSkillRequest,
} from '@garden/core/types'
import { getApiTransport } from './state'

export function getSkill(id: string): Promise<Skill> {
  return getApiTransport().request(`/api/skills/${id}`)
}

export function createSkill(data: CreateSkillRequest): Promise<Skill> {
  return getApiTransport().request('/api/skills', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateSkill(id: string, data: UpdateSkillRequest): Promise<Skill> {
  return getApiTransport().request(`/api/skills/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function deleteSkill(id: string): Promise<void> {
  return getApiTransport().request(`/api/skills/${id}`, { method: 'DELETE' })
}

export function importSkill(data: { url: string }): Promise<Skill> {
  return getApiTransport().request('/api/skills/import', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function searchSkills(
  query: string,
  limit = 10,
): Promise<SkillsShSearchResult[]> {
  const search = new URLSearchParams({ q: query, limit: String(limit) })
  return getApiTransport().request(`/api/skills/search?${search}`)
}

export function previewSkill(url: string): Promise<SkillPreview> {
  return getApiTransport().request('/api/skills/preview', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}
