import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileViewer } from './file-viewer'

vi.mock('../../common/markdown', async () => {
  const markdown = await import('@garden/ui/markdown')
  return { Markdown: markdown.Markdown }
})

const content = `---
name: qa-security-sweep
description: Audit a feature
metadata:
  category: QA
  tags:
    - security
---
## Purpose
Review the feature.

## Steps
Run the checks.

\`\`\`md
## Not an outline heading
\`\`\`

## Steps
Repeat after changes.
`

describe('skill document reader', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([false, true])(
    'keeps outline selection until scrollend with reduced motion %s',
    (reducedMotion) => {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        ...mediaQuery,
        media: query,
        matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
      }))
      render(<FileViewer path="SKILL.md" content={content} />)
      const outline = screen.getByRole('navigation', { name: 'On this page' })
      const reader = outline.previousElementSibling
      const entries = within(outline).getAllByRole('button')
      const target = entries[2]
      const first = entries[0]
      const middle = entries[1]
      if (!reader || !target || !first || !middle)
        throw new Error('Missing reader or outline entries')
      let offset = 0
      const headings = screen
        .getAllByRole('heading')
        .filter((heading) => heading.id)
      headings.forEach((heading, index) => {
        heading.scrollIntoView = vi.fn(() => {
          if (reducedMotion) reader.scrollTop = index * 200
        })
        vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(
          () => new DOMRect(0, index * 200 - offset, 400, 30),
        )
      })
      Object.defineProperty(reader, 'scrollTo', {
        configurable: true,
        value: vi.fn(),
      })
      fireEvent.click(target)
      expect(headings[2]?.scrollIntoView).toHaveBeenCalledWith({
        behavior: reducedMotion ? 'instant' : 'smooth',
        block: 'start',
      })
      fireEvent.scroll(reader)
      expect(target).toHaveAttribute('aria-current', 'location')
      offset = 200
      fireEvent.scroll(reader)
      expect(target).toHaveAttribute('aria-current', 'location')
      offset = 400
      fireEvent.scroll(reader)
      fireEvent(reader, new Event('scrollend'))
      offset = 0
      fireEvent.scroll(reader)
      expect(first).toHaveAttribute('aria-current', 'location')

      fireEvent.click(target)
      offset = 200
      fireEvent.wheel(reader)
      fireEvent.scroll(reader)
      expect(middle).toHaveAttribute('aria-current', 'location')
    },
  )

  it('resumes tracking after a reduced-motion jump that does not move the reader', () => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...mediaQuery,
      media: query,
      matches: query === '(prefers-reduced-motion: reduce)',
    }))
    render(<FileViewer path="SKILL.md" content={content} />)
    const reader = screen.getByRole('region', { name: 'Skill document' })
    const outline = within(
      screen.getByRole('navigation', { name: 'On this page' }),
    )
    const entries = outline.getAllByRole('button')
    const target = entries[2]
    const middle = entries[1]
    const headings = screen
      .getAllByRole('heading')
      .filter((heading) => heading.id)
    const heading = headings[2]
    if (!target || !middle || !heading)
      throw new Error('Missing outline target')
    let offset = 0
    vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 100),
    )
    headings.forEach((item, index) => {
      vi.spyOn(item, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, index * 200 - offset, 400, 30),
      )
    })
    heading.scrollIntoView = vi.fn()
    fireEvent.click(target)
    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'start',
    })
    expect(target).toHaveAttribute('aria-current', 'location')
    // No-op jumps emit no scrollend. A later scroll must still update selection.
    offset = 200
    fireEvent.scroll(reader)
    expect(middle).toHaveAttribute('aria-current', 'location')
  })

  it('collapses frontmatter and preserves nested YAML when expanded', () => {
    render(<FileViewer path="SKILL.md" content={content} />)
    const summary = screen.getByText('Frontmatter · 3 fields')
    const details = summary.closest('details')
    if (!details) throw new Error('Missing frontmatter disclosure')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(summary)
    expect(details).toHaveAttribute('open')
    expect(within(details).getByText(/tags:\s+- security/)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Purpose' })).toBeVisible()
  })

  it('shows complete raw source without enabling an editor', () => {
    render(<FileViewer path="SKILL.md" content={content} mode="source" />)
    expect(screen.getByLabelText('Source of SKILL.md').textContent).toBe(
      content,
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(
      screen.queryByRole('navigation', { name: 'On this page' }),
    ).toBeNull()
  })

  it('builds the outline from rendered headings and navigates duplicate titles separately', () => {
    render(<FileViewer path="SKILL.md" content={content} />)
    const outline = within(
      screen.getByRole('navigation', { name: 'On this page' }),
    )
    expect(outline.getAllByRole('button')).toHaveLength(3)
    expect(
      outline.queryByRole('button', { name: 'Not an outline heading' }),
    ).toBeNull()
    const headings = screen.getAllByRole('heading', { name: 'Steps' })
    expect(headings[0]?.id).not.toBe(headings[1]?.id)
    const last = headings[1]
    const lastButton = outline.getAllByRole('button', { name: 'Steps' })[1]
    if (!last || !lastButton) throw new Error('Missing second Steps heading')
    last.scrollIntoView = vi.fn()
    fireEvent.click(lastButton)
    expect(last.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    })
    expect(
      outline.getAllByRole('button', { name: 'Steps' })[1],
    ).toHaveAttribute('aria-current', 'location')
  })

  it('edits the complete document and keeps non-Markdown files readable', () => {
    const onChange = vi.fn()
    const view = render(
      <FileViewer
        path="SKILL.md"
        content={content}
        mode="edit"
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit SKILL.md' }), {
      target: { value: 'Updated document' },
    })
    expect(onChange).toHaveBeenCalledWith('Updated document')
    view.rerender(<FileViewer path="scripts/check.sh" content="echo check" />)
    expect(
      screen.getByLabelText('Source of scripts/check.sh'),
    ).toHaveTextContent('echo check')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps the active outline entry visible when reading down and back up', () => {
    render(<FileViewer path="SKILL.md" content={content} />)
    const outline = screen.getByRole('navigation', { name: 'On this page' })
    const reader = outline.previousElementSibling
    if (!reader) throw new Error('Missing document panel')
    Object.defineProperty(outline, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    vi.spyOn(outline, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 120, 100),
    )
    vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 100),
    )
    const entries = within(outline).getAllByRole('button')
    entries.forEach((entry, index) => {
      vi.spyOn(entry, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, 10.5 + index * 150 - outline.scrollTop, 120, 44),
      )
    })
    let section = 0
    const headings = screen
      .getAllByRole('heading')
      .filter((heading) => heading.id)
    headings.forEach((heading, index) => {
      vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, (index - section) * 200, 400, 30),
      )
    })
    const activeEntry = () => {
      const entry = entries.find(
        (entry) => entry.getAttribute('aria-current') === 'location',
      )
      if (!entry) throw new Error('Missing active outline entry')
      return entry.getBoundingClientRect()
    }

    reader.scrollTop = 200
    section = 2
    fireEvent.scroll(reader)
    expect(activeEntry().top).toBeGreaterThanOrEqual(0)
    expect(activeEntry().bottom).toBeLessThanOrEqual(outline.clientHeight)
    expect(reader.scrollTop).toBe(200)
    const scrolledDown = outline.scrollTop

    reader.scrollTop = 0
    section = 0
    fireEvent.scroll(reader)
    expect(activeEntry().top).toBeGreaterThanOrEqual(0)
    expect(activeEntry().bottom).toBeLessThanOrEqual(outline.clientHeight)
    expect(outline.scrollTop).toBeLessThan(scrolledDown)
    expect(reader.scrollTop).toBe(0)

    const visiblePosition = outline.scrollTop
    fireEvent.scroll(reader)
    expect(outline.scrollTop).toBe(visiblePosition)
  })
})
