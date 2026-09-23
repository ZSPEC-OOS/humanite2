import { getApiConfig, StoredApiConfig } from '@/lib/r2'

// The server-side lookup that replaced trusting a client-supplied
// api_config in the request body: humanize/scan routes call this with the
// authenticated caller's own user id and use whatever comes back — the
// browser no longer holds (or sends) the raw key at all, see
// apiConfigStore.ts and ApiConfigModal.tsx. Wraps getApiConfig with a wider
// safety net than its own NoSuchKey-only handling: R2 being entirely
// unconfigured (no R2_ACCOUNT_ID etc. — a supported, degrade-gracefully
// deployment mode per .env.local.template) throws from getApiConfig's own
// client() call, which must not take every humanize/scan request down with
// it. Any failure here means "no custom config", falling through to this
// deployment's env-configured defaults, exactly like every other
// R2-dependent feature in this app.
export async function getUserApiConfig(userId: string): Promise<StoredApiConfig | null> {
  try {
    return await getApiConfig(userId)
  } catch (err) {
    console.warn('User API config lookup unavailable — using server defaults', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return null
  }
}
