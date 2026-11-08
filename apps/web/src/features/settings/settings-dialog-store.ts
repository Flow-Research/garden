import { create } from 'zustand'

interface SettingsDialogState {
  open: boolean
  /** The selected tab. It outlives the dialog so a reopen lands where the user left off. */
  activeTab: string
  /** Opens Settings on `tab`, or on the last selected tab when none is given. */
  openSettings: (tab?: string) => void
  closeSettings: () => void
  setOpen: (open: boolean) => void
  setActiveTab: (tab: string) => void
}

/**
 * Settings dialog state. Before, the dialog stored only a deep-link tab and
 * remounted its tabs on every open, so a plain reopen always reset to Account.
 * The Teams admin spec asks that the selected tab survive a reopen, so the
 * selected tab now lives here and the tabs are controlled from it.
 */
export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  activeTab: 'profile',
  openSettings: (tab) =>
    set((state) => ({ open: true, activeTab: tab ?? state.activeTab })),
  closeSettings: () => set({ open: false }),
  setOpen: (open) => set({ open }),
  setActiveTab: (activeTab) => set({ activeTab }),
}))
