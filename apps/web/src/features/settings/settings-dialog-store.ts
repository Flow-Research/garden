import { create } from 'zustand'

interface SettingsDialogState {
  open: boolean
  initialTab: string | null
  openSettings: (initialTab?: string) => void
  closeSettings: () => void
  setOpen: (open: boolean) => void
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  initialTab: null,
  openSettings: (initialTab) =>
    set({ open: true, initialTab: initialTab ?? null }),
  closeSettings: () => set({ open: false }),
  setOpen: (open) => set({ open }),
}))
