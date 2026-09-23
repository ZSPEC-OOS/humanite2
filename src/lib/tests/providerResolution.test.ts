import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveProvider } from '../providerResolution'
import type { StoredApiConfig } from '../r2'

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}
afterEach(resetEnv)

function config(overrides: Partial<StoredApiConfig> = {}): StoredApiConfig {
  return { nickname: '', modelId: '', baseUrl: '', apiKey: '', gptzeroApiKey: '', ...overrides }
}

describe('resolveProvider', () => {
  it('uses full server defaults when there is no saved config at all', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-server')
    vi.stubEnv('OPENAI_BASE_URL', 'https://server.example/v1')
    vi.stubEnv('OPENAI_MODEL', 'server-model')
    const result = resolveProvider(null)
    expect(result).toEqual({
      apiKey: 'sk-server',
      baseURL: 'https://server.example/v1',
      model: 'server-model',
      usingByok: false,
    })
  })

  it('never lets a saved baseUrl/modelId pair with the server\'s own API key — the actual defect this closes', () => {
    // The exact exploit shape: a caller saves a third-party baseUrl and a
    // model, but never saves their own key. Before this fix, apiKey/baseURL
    // were defaulted independently per field, so this deployment's own
    // OPENAI_API_KEY would be sent to the caller-chosen endpoint.
    vi.stubEnv('OPENAI_API_KEY', 'sk-server-secret')
    vi.stubEnv('OPENAI_MODEL', 'gpt-4o-mini')
    const result = resolveProvider(config({ baseUrl: 'https://openrouter.ai/api/v1', modelId: 'expensive-model', apiKey: '' }))
    expect(result.usingByok).toBe(false)
    expect(result.apiKey).toBe('sk-server-secret')
    // The caller's chosen endpoint and model are BOTH ignored, not just the
    // key — using the server's key with the caller's endpoint/model is
    // exactly the credential-boundary violation, and using the server's key
    // with the caller's model alone still lets an arbitrary allowlisted
    // model run up this deployment's bill with no key paying for it.
    expect(result.baseURL).toBeUndefined()
    expect(result.model).toBe('gpt-4o-mini')
  })

  it('honors the full saved config, all three fields together, once a key is actually saved', () => {
    const result = resolveProvider(config({
      apiKey: 'sk-user-own-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      modelId: 'user-chosen-model',
    }))
    expect(result).toEqual({
      apiKey: 'sk-user-own-key',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'user-chosen-model',
      usingByok: true,
    })
  })

  it('falls back to the server model (not gpt-4o-mini blindly) when BYOK but no model was chosen', () => {
    vi.stubEnv('OPENAI_MODEL', 'server-default-model')
    const result = resolveProvider(config({ apiKey: 'sk-user-own-key' }))
    expect(result.model).toBe('server-default-model')
    expect(result.usingByok).toBe(true)
  })

  it('rejects a BYOK baseUrl that is not on the provider allowlist, even with a real key', () => {
    const result = resolveProvider(config({ apiKey: 'sk-user-own-key', baseUrl: 'https://attacker.example/internal' }))
    expect(result.baseURL).toBeUndefined()
    expect(result.usingByok).toBe(true)
    expect(result.apiKey).toBe('sk-user-own-key') // key itself is still honored — only the bad endpoint is dropped
  })
})
