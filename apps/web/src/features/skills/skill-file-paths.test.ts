import { describe, expect, it } from 'vitest'
import {
  fileBasename,
  fileParentDir,
  isValidRenameName,
  joinFilePath,
  renameCollides,
  rewriteFilePath,
} from './skill-file-paths'

describe('skill file paths', () => {
  it('rewrites a file or folder prefix', () => {
    expect(
      rewriteFilePath(
        'review/review.md',
        'review/review.md',
        'review/notes.md',
      ),
    ).toBe('review/notes.md')
    expect(rewriteFilePath('review/md', 'review', 'docs')).toBe('docs/md')
    expect(rewriteFilePath('SKILL.md', 'review', 'docs')).toBe('SKILL.md')
  })

  it('detects rename collisions and protected SKILL.md', () => {
    const paths = ['SKILL.md', 'review/md', 'review/review.md', 'notes.md']
    expect(renameCollides(paths, 'notes.md', 'review.md')).toBe(false)
    expect(renameCollides(paths, 'notes.md', 'review/md')).toBe(true)
    expect(renameCollides(paths, 'notes.md', 'SKILL.md')).toBe(true)
    expect(renameCollides(paths, 'review', 'docs')).toBe(false)
  })

  it('joins basename renames inside a parent folder', () => {
    expect(fileParentDir('review/review.md')).toBe('review')
    expect(fileBasename('review/review.md')).toBe('review.md')
    expect(joinFilePath('review', 'notes.md')).toBe('review/notes.md')
    expect(isValidRenameName('notes.md')).toBe(true)
    expect(isValidRenameName('nested/path')).toBe(false)
  })
})
