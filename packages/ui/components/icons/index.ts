/**
 * Icons drawn for the product that have no lucide equivalent. Hand-authored
 * rather than generated: the repo has no SVG-to-component build step, matching
 * `../common/brand-icon.tsx`.
 *
 * These are fill icons, not stroke icons — they paint with `currentColor` and
 * ignore `strokeWidth`, so size and colour come from `size-*` and text/icon
 * colour utilities at the call site.
 *
 * Each one is normalised to a `0 0 18 18` viewBox by an enclosing translate,
 * so the exported path data stays byte-identical to the source artboard and
 * only the frame moves. Re-exporting an icon means replacing the path and its
 * translate together.
 */
export type { IconComponent } from './types'

export { FileDocIcon } from './file-doc-icon'
export { DatabaseIcon } from './database-icon'
export { VectorThreeIcon } from './vector-three-icon'
export { CalendarCheckIcon } from './calendar-check-icon'
export { ImagesSquareIcon } from './images-square-icon'
export { BinocularsIcon } from './binoculars-icon'
export { ChartBarIcon } from './chart-bar-icon'
export { FolderIcon } from './folder-icon'
export { NotionIcon } from './notion-icon'
export { SlackIcon } from './slack-icon'
export { GmailIcon } from './gmail-icon'
export { GithubIcon } from './github-icon'
export { GoogleDriveIcon } from './google-drive-icon'
export { HarnessyIcon } from './harnessy-icon'
export { SlidersHorizontalIcon } from './sliders-horizontal'
