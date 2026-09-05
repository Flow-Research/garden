import { create } from 'zustand'

export type SkillsAddMode = 'browse' | 'author'

interface SkillsBrowseStore {
  browseSearch: string
  previewUrl: string | null
  addMode: SkillsAddMode | null
  listFilter: string
  setBrowseSearch: (value: string) => void
  setPreviewUrl: (value: string | null) => void
  setAddMode: (mode: SkillsAddMode | null) => void
  setListFilter: (value: string) => void
  reset: () => void
}

export const useSkillsBrowseStore = create<SkillsBrowseStore>((set) => ({
  browseSearch: '',
  previewUrl: null,
  addMode: null,
  listFilter: '',
  setBrowseSearch: (browseSearch) => set({ browseSearch }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setAddMode: (addMode) => set({ addMode }),
  setListFilter: (listFilter) => set({ listFilter }),
  reset: () =>
    set({ browseSearch: '', previewUrl: null, addMode: null, listFilter: '' }),
}))

// ---------------------------------------------------------------------------
// Skill editor cross-surface state
// ---------------------------------------------------------------------------
// The skills page (right pane) owns the editor's local bundle state, but the
// sidebar's skills explorer renders the file tree of whatever skill is being
// edited. This store is the bridge: the editor publishes its file list and
// selected path here, the sidebar reads them and writes back path selections.

interface SkillFileMutations {
  renameFile: (fromPath: string, toPath: string) => void
  deleteFile: (path: string) => void
}

interface SkillEditorStore {
  activeSkillId: string | null
  filePaths: string[]
  selectedPath: string
  fileMutations: SkillFileMutations | null
  setActiveBundle: (skillId: string, filePaths: string[]) => void
  setFilePaths: (filePaths: string[]) => void
  setSelectedPath: (path: string) => void
  setFileMutations: (fileMutations: SkillFileMutations | null) => void
  clear: () => void
}

export const useSkillEditorStore = create<SkillEditorStore>((set) => ({
  activeSkillId: null,
  filePaths: [],
  selectedPath: 'SKILL.md',
  fileMutations: null,
  setActiveBundle: (activeSkillId, filePaths) =>
    set({ activeSkillId, filePaths, selectedPath: 'SKILL.md' }),
  setFilePaths: (filePaths) => set({ filePaths }),
  setSelectedPath: (selectedPath) => set({ selectedPath }),
  setFileMutations: (fileMutations) => set({ fileMutations }),
  clear: () =>
    set({
      activeSkillId: null,
      filePaths: [],
      selectedPath: 'SKILL.md',
      fileMutations: null,
    }),
}))
