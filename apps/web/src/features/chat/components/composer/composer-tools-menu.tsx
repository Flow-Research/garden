/**
 * ComposerToolsMenu — the left-hand tools control in the Tiptap-based chat
 * composer footer (2026-09-08 spec §8.1, reshaped 2026-09-17 to the Penpot
 * tools-menu board).
 *
 * Fully controlled: the selected preset comes in as `presetId` and every
 * change leaves through `onPresetChange`. Task 12 owns that state; this
 * component owns none.
 *
 * The presets are static config with no backend behind them yet (2026-09-08
 * spec, verdict D: build the UI as designed, wire it up later). Selecting one
 * is still inert beyond the trigger's label and tint, and whether the footer
 * shows the `Sources` control beside it — it does not change what tools are
 * actually available to the model.
 *
 * The trigger shows the selected preset's own icon and accent tint rather
 * than a fixed sliders glyph, so the active tool is readable from the footer
 * without opening the menu. `Default` has no tint (`accentClassName` is
 * empty) because it is the resting state, not a choice someone made.
 *
 * What the 2026-09-17 redesign changed
 * ------------------------------------
 * The popover used to carry three stacked sections: the preset radio group, a
 * collapsible "Sources" list of attached documents, and a tool-permission
 * radio group. The new design is a single flat list of the six presets. Both
 * other sections were removed rather than hidden:
 *
 * - **Attached-document chips.** They mirrored the `+` menu's document picker
 *   as a second view onto the same list. Removing a document is still
 *   possible from the `+` picker itself and from the chip strip the composer
 *   renders above the pill (`composer.tsx`, the `selectedDocumentIds` map,
 *   which has its own per-chip remove button), so nothing became unreachable.
 * - **Permission mode.** Carried over verbatim from the old
 *   `chat-composer.tsx` and inert the whole time it lived here: verified
 *   again that `useToolApprovals` takes `{ sessionId, messages,
 *   addToolApprovalResponse, continueAfterGardenApproval }` with no mode
 *   argument. Its state was local to `composer.tsx` and fed nothing but this
 *   popover, so it went with the section. This is a UI removal, not a
 *   behaviour change — tool approval works exactly as it did.
 *
 * Sources live in the footer, not here. Three of the six presets draw on
 * external documents (`TOOL_PRESET_IDS_WITH_SOURCES`); while one of those is
 * selected, `composer.tsx` renders `ComposerSourcesMenu` next to this
 * trigger. That control is a sibling in the composer row, not a section of
 * this popover.
 *
 * Built on `DropdownMenu` from `@garden/ui/components/ui/dropdown-menu`
 * (Base UI `Menu` under the hood), matching how the rest of the repo composes
 * dropdown popovers.
 */

import type { ReactElement } from 'react'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { cn } from '@garden/ui/lib/utils'
import {
  DEFAULT_TOOL_PRESET_ID,
  TOOL_PRESETS,
  type ToolPresetId,
} from './composer-tools'

export function ComposerToolsMenu(props: {
  presetId: ToolPresetId
  onPresetChange: (id: ToolPresetId) => void
}): ReactElement {
  const { presetId, onPresetChange } = props

  const selectedPreset =
    TOOL_PRESETS.find((preset) => preset.id === presetId) ??
    TOOL_PRESETS.find((preset) => preset.id === DEFAULT_TOOL_PRESET_ID) ??
    TOOL_PRESETS[0]!
  const SelectedIcon = selectedPreset.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            aria-label="Tools"
            className={cn(
              'h-8 gap-3 rounded-full px-2',
              selectedPreset.accentClassName,
            )}
          >
            <SelectedIcon
              className={cn('size-4', selectedPreset.iconClassName)}
            />
            <span className="body-small text-text-default">
              {selectedPreset.label}
            </span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6} className="w-64">
        <DropdownMenuRadioGroup
          value={presetId}
          onValueChange={(value) => onPresetChange(value as ToolPresetId)}
        >
          {TOOL_PRESETS.map((preset) => {
            const Icon = preset.icon
            return (
              <DropdownMenuRadioItem
                key={preset.id}
                value={preset.id}
                className="gap-3 py-2"
              >
                <Icon className={cn('size-4 shrink-0', preset.iconClassName)} />
                <span className="body-small text-text-default">
                  {preset.label}
                </span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
