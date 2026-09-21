import { create } from 'zustand'

interface EditorState {
  text: string
  setText: (text: string) => void
  clearText: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  text: '',
  setText: (text) => set({ text }),
  clearText: () => set({ text: '' }),
}))
