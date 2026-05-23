'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createPersistStorage, defaultStorage } from '@garden/core/platform'

const DEV_SETTINGS_STORAGE_KEY = 'garden_dev_settings'

interface DevSettingsState {
  debugMode: boolean
  setDebugMode: (enabled: boolean) => void
}

export const useDevSettingsStore = create<DevSettingsState>()(
  persist(
    (set) => ({
      debugMode: false,
      setDebugMode: (enabled) => set({ debugMode: enabled }),
    }),
    {
      name: DEV_SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => createPersistStorage(defaultStorage)),
      partialize: (state) => ({ debugMode: state.debugMode }),
    },
  ),
)
