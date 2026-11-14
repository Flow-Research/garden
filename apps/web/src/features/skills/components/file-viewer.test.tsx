import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
})
