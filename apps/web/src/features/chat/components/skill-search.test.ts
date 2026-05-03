import { describe, expect, it } from 'vitest'
import type { ComposerSkill } from '../chat-runtime-provider'
import { searchComposerSkills } from './skill-search'

const skills = [
  {
    id: 'windows',
    slug: 'windows-automation',
    name: 'Windows Automation',
    description: 'Automate desktop flows',
  },
  {
    id: 'darwin',
    slug: 'darwin-build',
    name: 'macOS Builds',
    description: 'Package Apple desktop builds',
  },
  {
    id: 'docs',
    slug: 'technical-writing',
    name: 'Technical Writing',
    description: 'Write docs for Windows installers',
  },
  {
    id: 'github',
    slug: 'github',
    name: 'GitHub',
    description: 'Pull requests and issues',
  },
] satisfies ComposerSkill[]

describe('searchComposerSkills', () => {
  it('returns all skills when there is no query', () => {
    expect(searchComposerSkills(skills, '').map((skill) => skill.id)).toEqual([
      'windows',
      'darwin',
      'docs',
      'github',
    ])
  })

  it('filters slash queries by skills that contain the typed text', () => {
    expect(searchComposerSkills(skills, '/win').map((skill) => skill.id)).toEqual(
      ['windows', 'darwin', 'docs'],
    )
  })

  it('ranks command fields ahead of description matches', () => {
    expect(searchComposerSkills(skills, 'windows').map((skill) => skill.id)).toEqual(
      ['windows', 'docs'],
    )
  })
})
