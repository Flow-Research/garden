/**
 * ComposerAddMenu — the `+` dropdown for adding files to the chat.
 *
 * Extracted from `chat-composer.tsx` (~lines 945-1020). Trigger glyph changed from
 * `Paperclip` to `Plus` per 2026-09-08 spec §8.1.
 *
 * Before: the menu carried an "Add context" group plus a "Documents in this
 * chat" group — a controlled checkbox list of thread documents with
 * loading/error/empty affordances. After: two flat actions only, per the
 * Board design. Thread-document selection has no entry point in the composer
 * any more; the chip row in `composer.tsx` now only repopulates through
 * `ComposerHandle.restoreDraft` when a queued message is put back.
 *
 * The Drive action is intentionally visual-only until its picker flow exists,
 * so it renders `disabled` rather than as a live no-op item.
 *
 * Sources: chat-composer.tsx ~945-1020; @garden/ui DropdownMenu components
 * (Base UI Menu under the hood); lucide-react Plus icon; `GoogleDriveIcon`
 * from `@garden/ui/components/icons` (sized via `className`, since these icons
 * take `SVGProps` and have no `size` prop).
 */

import { Paperclip, Plus } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import type { ReactElement } from 'react'
import { GoogleDriveIcon } from '@garden/ui/components/icons'

export function ComposerAddMenu(props: {
  onUploadClick: () => void
}): ReactElement {
  const { onUploadClick } = props

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-sm text-icon-default"
            aria-label="Add files"
          >
            <Plus className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-40 p-2">
        <DropdownMenuItem onClick={onUploadClick} className="gap-3">
          <Paperclip className="size-4" />
          Upload files
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-3">
          <GoogleDriveIcon className="size-[18px]" />
          Add from Drive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
