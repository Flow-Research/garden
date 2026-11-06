import { create } from 'zustand'

export type SkillsAddMode = 'browse' | 'author'

interface SkillsBrowseStore {
  browseSearch: string
  previewUrl: string | null
  addMode: SkillsAddMode | null
  setBrowseSearch: (value: string) => void
  setPreviewUrl: (value: string | null) => void
  setAddMode: (mode: SkillsAddMode | null) => void
  reset: () => void
}

export const useSkillsBrowseStore = create<SkillsBrowseStore>((set) => ({
  browseSearch: '',
  previewUrl: null,
  addMode: null,
  setBrowseSearch: (browseSearch) => set({ browseSearch }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setAddMode: (addMode) => set({ addMode }),
  reset: () => set({ browseSearch: '', previewUrl: null, addMode: null }),
}))
