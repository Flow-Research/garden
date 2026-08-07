import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

interface SearchState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const searchStore = createStore<SearchState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}))

type SearchHook = {
  <Selected>(selector: (state: SearchState) => Selected): Selected
  getState: typeof searchStore.getState
  setState: typeof searchStore.setState
}

/** Bound search-overlay hook with explicit vanilla-store access for event handlers and tests. */
export const useSearchStore = Object.assign(
  <Selected>(selector: (state: SearchState) => Selected) =>
    useStore(searchStore, selector),
  {
    getState: searchStore.getState,
    setState: searchStore.setState,
  },
) as SearchHook
