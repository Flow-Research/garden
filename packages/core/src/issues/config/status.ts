import type { IssueStatus } from '../../types'

export const STATUS_ORDER: IssueStatus[] = [
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
]

export const ALL_STATUSES: IssueStatus[] = [
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
]

/** Statuses shown as board columns (excludes cancelled). */
export const BOARD_STATUSES: IssueStatus[] = [
  'blocked',
  'todo',
  'in_progress',
  'in_review',
  'done',
]

/**
 * One status vocabulary for every view. `iconColor` and `hoverBg` follow the
 * semantic tokens. `pillFill` is the design's pastel fill, the same in light
 * and dark themes, so `pillText` (dark text) stays readable on it in both.
 * Status pills, the board columns and the dashboard chart all use it, so a
 * status reads as the same colour everywhere.
 */
export const STATUS_CONFIG: Record<
  IssueStatus,
  {
    label: string
    iconColor: string
    hoverBg: string
    pillFill: string
  }
> = {
  todo: {
    label: 'Todo',
    iconColor: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    pillFill: 'var(--util-color-9)',
  },
  in_progress: {
    label: 'In Progress',
    iconColor: 'text-warning',
    hoverBg: 'hover:bg-warning/10',
    pillFill: 'var(--util-color-2)',
  },
  in_review: {
    label: 'In Review',
    iconColor: 'text-info',
    hoverBg: 'hover:bg-info/10',
    pillFill: 'var(--util-color-7)',
  },
  done: {
    label: 'Done',
    iconColor: 'text-success',
    hoverBg: 'hover:bg-success/10',
    pillFill: 'var(--util-color-8)',
  },
  blocked: {
    label: 'Blocked',
    iconColor: 'text-destructive',
    hoverBg: 'hover:bg-destructive/10',
    pillFill: 'var(--util-color-10)',
  },
  cancelled: {
    label: 'Cancelled',
    iconColor: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    pillFill: 'var(--util-color-5)',
  },
}

/** Text class for a status pill on `pillFill`. */
export const STATUS_PILL_TEXT = 'text-gray-900'
