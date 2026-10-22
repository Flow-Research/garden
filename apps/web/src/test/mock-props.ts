import type { ReactNode } from 'react'

/** Selector passed to a mocked zustand hook; mocks call it with their state. */
export type MockSelector = (state: Record<string, unknown>) => unknown

/** Props of pass-through mocks (Popover, Tooltip, Accordion, DnD contexts). */
export type ChildrenProps = { children?: ReactNode }

/** Base UI style triggers render `render` when given, otherwise children. */
export type TriggerProps = { children?: ReactNode; render?: ReactNode }

/** Props shared by the ContentEditor and TitleEditor mocks. */
export type MockEditorProps = {
  defaultValue?: string
  placeholder?: string
  onUpdate?: (value: string) => void
  onChange?: (value: string) => void
  onBlur?: (value: string) => void
  onSubmit?: () => void
}

/** Imperative handle exposed by the ContentEditor mocks. */
export type MockContentEditorHandle = {
  getMarkdown: () => string
  uploadFile: () => void
  clearContent?: () => void
  focus?: () => void
}

/** Imperative handle exposed by the TitleEditor mock. */
export type MockTitleEditorHandle = {
  getText: () => string
  focus: () => void
}
