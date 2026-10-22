import {
  Brain,
  FileSearch,
  FileText,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'
import {
  BinocularsIcon,
  CalendarCheckIcon,
  ChartBarIcon,
  DatabaseIcon,
  FileDocIcon,
  ImagesSquareIcon,
  SlidersHorizontalIcon,
  VectorThreeIcon,
  type IconComponent,
} from '@garden/ui/components/icons'

/**
 * Static config for the composer's tools popover and its empty-state
 * suggestion pills. The tool presets have no backend yet (2026-09-08 spec,
 * verdict D: build the UI as designed, backend later). This file is the single
 * source of truth for both lists so UI, tests, and any future wiring agree.
 *
 * The folder, connected-app and tool-source stubs that used to live here went
 * with the controls that rendered them (the composer's extension row and its
 * `Sources` menu), removed in the 2026-09-17 review as no-ops.
 */

export type ToolPresetId =
  | 'qa-agent'
  | 'eng-issue-triage'
  | 'org-brain'
  | 'research-synthesis'
  | 'document-review'
  | 'default'

export interface ToolPreset {
  id: ToolPresetId
  label: string
  /**
   * Typed `IconComponent` rather than lucide's `LucideIcon` because the
   * presets mix Lucide glyphs with this repo's hand-authored icon set, so the
   * registry has to hold both.
   */
  icon: IconComponent
  /**
   * Per-preset accent colour for the icon, as Tailwind text classes. The
   * design gives each preset its own hue rather than a single muted icon
   * colour, and the hue is the only thing distinguishing the two
   * file-shaped glyphs at a glance. Raw palette classes with a lighter dark
   * variant, matching how the rest of the app tints one-off accents (see
   * `chat-artifacts.tsx`, `automation-detail-page.tsx`) — there are no
   * semantic tokens for these hues.
   */
  iconClassName: string
  /**
   * Tint for the composer's tools trigger while this preset is selected, as
   * Tailwind background classes. The footer shows the active preset as a
   * tinted pill (2026-09-17 composer-field board) so the current tool is
   * readable without opening the menu; `default` carries no tint because it
   * is the resting state, not a choice the person made.
   */
  accentClassName: string
}

/**
 * The six presets, in the order the tools menu lists them (Default first,
 * then most-to-least general). This order is the design's, not alphabetical
 * or definition order, and the menu renders the array as-is.
 */
export const TOOL_PRESETS: readonly ToolPreset[] = [
  {
    id: 'default',
    label: 'Default',
    icon: SlidersHorizontalIcon,
    iconClassName: 'text-icon-default',
    accentClassName: '',
  },
  {
    id: 'qa-agent',
    label: 'QA Agent',
    icon: SlidersHorizontal,
    iconClassName: 'text-orange-500 dark:text-orange-400',
    accentClassName: 'bg-orange-500/10 dark:bg-orange-400/15',
  },
  {
    id: 'eng-issue-triage',
    label: 'Engineering Issue Triage',
    icon: Settings2,
    iconClassName: 'text-blue-500 dark:text-blue-400',
    accentClassName: 'bg-blue-500/10 dark:bg-blue-400/15',
  },
  {
    id: 'org-brain',
    label: 'Org. Brain',
    icon: Brain,
    iconClassName: 'text-purple-500 dark:text-purple-400',
    accentClassName: 'bg-purple-500/10 dark:bg-purple-400/15',
  },
  {
    id: 'research-synthesis',
    label: 'Research Synthesis',
    icon: FileSearch,
    iconClassName: 'text-fuchsia-500 dark:text-fuchsia-400',
    accentClassName: 'bg-fuchsia-500/10 dark:bg-fuchsia-400/15',
  },
  {
    id: 'document-review',
    label: 'Document Review',
    icon: FileText,
    iconClassName: 'text-blue-500 dark:text-blue-400',
    accentClassName: 'bg-blue-500/10 dark:bg-blue-400/15',
  },
]

export const DEFAULT_TOOL_PRESET_ID: ToolPresetId = 'default'

export interface SuggestionPill {
  id: string
  label: string
  /**
   * Typed `IconComponent`, not `LucideIcon`: these are the product's own
   * fill icons rather than lucide glyphs. The wider type also lets a pill
   * fall back to a lucide icon if a drawn one is ever missing.
   */
  icon: IconComponent
  /** Prefilled into the composer draft on click (same behavior as the old tiles). */
  starter: string
}

export const SUGGESTION_PILLS: readonly SuggestionPill[] = [
  {
    id: 'draft-document',
    label: 'Draft a document',
    icon: FileDocIcon,
    starter: 'Help me draft a document about ',
  },
  {
    id: 'org-knowledge',
    label: 'Org. knowledge',
    icon: DatabaseIcon,
    starter: 'What does the org know about ',
  },
  {
    id: 'plan-activity',
    label: 'Plan & track your activity',
    icon: VectorThreeIcon,
    starter: 'Help me plan and track my work. Here is what is on my plate: ',
  },
  {
    id: 'structure-calendar',
    label: 'Structure calendar',
    icon: CalendarCheckIcon,
    starter: 'Help me structure my calendar for ',
  },
  {
    id: 'generate-images',
    label: 'Generate images',
    icon: ImagesSquareIcon,
    starter: 'Generate an image of ',
  },
  {
    id: 'deep-research',
    label: 'Deep research',
    icon: BinocularsIcon,
    starter: 'Do deep research on ',
  },
  {
    id: 'analyse-data',
    label: 'Analyse data',
    icon: ChartBarIcon,
    starter: 'Help me analyse this data: ',
  },
]
