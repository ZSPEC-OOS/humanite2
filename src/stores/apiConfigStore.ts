import { create } from 'zustand'
import { useUserStore } from './userStore'

// What the browser is allowed to hold: never a raw key, only whether one is
// configured and a masked hint ("••••4F91") — the server is the only place
// that ever sees (or stores) the real value. See ApiConfigModal.tsx for the
// save flow this backs: a raw key typed there goes straight to the server
// as a one-off call argument and is never assigned into this store's state.
export interface ApiConfigMeta {
  nickname: string
  modelId: string
  baseUrl: string
  hasApiKey: boolean
  apiKeyHint: string
  hasGptzeroKey: boolean
  gptzeroKeyHint: string
}

// The raw values a save actually sends — held only as a function argument
// and request body, never stored anywhere on the client.
export interface ModelConfigDraft {
  nickname: string
  modelId: string
  baseUrl: string
  apiKey: string
  gptzeroApiKey: string
}

interface ApiConfigState {
  config: ApiConfigMeta
  hasCustomConfig: () => boolean
  hasCustomGptzeroKey: () => boolean
  // Sends a draft to the server once; adopts whatever sanitized metadata
  // comes back. An empty apiKey/gptzeroApiKey in the draft leaves that
  // field's stored value untouched server-side (see the route) rather than
  // clearing it — this lets a save that only changes the nickname, say, not
  // wipe out an existing key.
  saveModelConfig: (draft: ModelConfigDraft) => Promise<void>
  clearConfig: () => Promise<void>
  // Pulls this account's config metadata from the server. Best-effort —
  // silently no-ops if the server/R2 isn't reachable or nothing's been
  // saved yet.
  syncFromServer: () => Promise<void>
}

const STORAGE_KEY = 'humanite_api_config_meta'
const DEFAULTS: ApiConfigMeta = {
  nickname: '', modelId: '', baseUrl: '',
  hasApiKey: false, apiKeyHint: '',
  hasGptzeroKey: false, gptzeroKeyHint: '',
}

function load(): ApiConfigMeta {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function save(meta: ApiConfigMeta) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)) } catch { /* ignore */ }
}

// Raw fetch rather than the shared apiFetch() helper (src/lib/api.ts) —
// that module imports this store, so importing it back here would be
// circular. Deliberately minimal: same auth header convention, no retries.
async function configFetch(method: 'GET' | 'PUT', body?: unknown) {
  const token = useUserStore.getState().accessToken
  const resp = await fetch('/api/v1/user/api-config', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!resp.ok) throw new Error(`Config request failed: HTTP ${resp.status}`)
  return resp.json() as Promise<{ config: ApiConfigMeta }>
}

export const useApiConfigStore = create<ApiConfigState>((set, get) => ({
  config: load(),

  hasCustomConfig: () => {
    const { hasApiKey, modelId } = get().config
    return hasApiKey && !!modelId.trim()
  },

  hasCustomGptzeroKey: () => get().config.hasGptzeroKey,

  saveModelConfig: async (draft) => {
    const { config } = await configFetch('PUT', {
      nickname: draft.nickname,
      modelId: draft.modelId,
      baseUrl: draft.baseUrl,
      // Omitted (not just empty-string) when blank, so the server's
      // "leave existing value alone" branch actually triggers.
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      ...(draft.gptzeroApiKey.trim() ? { gptzeroApiKey: draft.gptzeroApiKey.trim() } : {}),
    })
    save(config)
    set({ config })
  },

  clearConfig: async () => {
    const { config } = await configFetch('PUT', { clear: true })
    save(config)
    set({ config })
  },

  syncFromServer: async () => {
    try {
      const { config } = await configFetch('GET')
      save(config)
      set({ config })
    } catch {
      // best-effort — keep whatever's local
    }
  },
}))
