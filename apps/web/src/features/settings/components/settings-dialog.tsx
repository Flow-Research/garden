'use client'

import {
  Dialog,
  DialogContent,
} from '@garden/ui/components/ui/dialog'
import { useSettingsDialogStore } from '../settings-dialog-store'
import { SettingsPage } from './settings-page'
import type { ExtraSettingsTab } from './settings-page'

interface SettingsDialogProps {
  extraAccountTabs?: ExtraSettingsTab[]
}

export function SettingsDialog({ extraAccountTabs }: SettingsDialogProps = {}) {
  const open = useSettingsDialogStore((s) => s.open)
  const setOpen = useSettingsDialogStore((s) => s.setOpen)
  const initialTab = useSettingsDialogStore((s) => s.initialTab)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton
        className="h-[85vh] max-h-[900px] w-[calc(100%-2rem)] max-w-5xl overflow-hidden p-0 sm:max-w-5xl"
      >
        <SettingsPage
          // Remount when the dialog reopens with a different deep-link so the
          // internal Tabs `defaultValue` actually kicks in.
          key={`${open ? 'open' : 'closed'}:${initialTab ?? 'profile'}`}
          defaultTab={initialTab ?? 'profile'}
          extraAccountTabs={extraAccountTabs}
        />
      </DialogContent>
    </Dialog>
  )
}
