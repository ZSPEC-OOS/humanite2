import { create } from 'zustand'

export interface ApiConfig {
  nickname: string
  modelId: string
  baseUrl: string
  apiKey: string
}

interface ApiConfigState {
  config: ApiConfig
  setConfig: (patch: Partial<ApiConfig>) => void
  clearConfig: () => void
  hasCustomConfig: () => boolean
}

const STORAGE_KEY = 'humanite_api_config'
const DEFAULTS: ApiConfig = { nickname: '', modelId: '', baseUrl: '', apiKey: '' }

function load(): ApiConfig {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function save(config: ApiConfig) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* ignore */ }
}

export const useApiConfigStore = create<ApiConfigState>((set, get) => ({
  config: load(),

  setConfig: (patch) => {
    const next = { ...get().config, ...patch }
    save(next)
    set({ config: next })
  },

  clearConfig: () => {
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
    set({ config: DEFAULTS })
  },

  hasCustomConfig: () => {
    const { apiKey, modelId } = get().config
    return !!(apiKey.trim() && modelId.trim())
  },
}))
