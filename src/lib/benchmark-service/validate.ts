/**
 * Strict request validation for POST /api/v1/benchmark/run.
 * Error messages name fields only; they never echo input values.
 */
import { TONES, DOMAINS, GENRES, AUDIENCES } from '@/lib/style/types'

export const OPERATIONS = ['humanize', 'repair_grammar', 'repair_facts'] as const
export type BenchmarkOperation = (typeof OPERATIONS)[number]

export const MAX_TEXT_CHARS = 50_000
export const MAX_BODY_BYTES = 256 * 1024
export const MIN_INTENSITY = 1
export const MAX_INTENSITY = 10
export const MAX_CANDIDATE_OVERRIDE = 5

export interface BenchmarkSettings {
  intensity: number
  tone: string
  domain: string
  genre: string | null
  audience: string | null
}

export interface BenchmarkRequest {
  operation: BenchmarkOperation
  text: string
  settings: BenchmarkSettings
  candidateCountOverride: number | null
  extra: { sourceText?: string; tone?: string; domain?: string }
}

export type ValidationResult = { ok: true; value: BenchmarkRequest } | { ok: false; message: string }

const fail = (message: string): ValidationResult => ({ ok: false, message })

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function unknownKeys(obj: Record<string, unknown>, allowed: string[]): string | null {
  const bad = Object.keys(obj).find(k => !allowed.includes(k))
  return bad === undefined ? null : 'unknown field'
}

function checkText(value: unknown, field: string): string | null {
  if (typeof value !== 'string') return `${field} must be a string.`
  if (value.trim().length === 0) return `${field} must not be empty.`
  if (value.length > MAX_TEXT_CHARS) return `${field} must be at most ${MAX_TEXT_CHARS} characters.`
  return null
}

export function validateBenchmarkRequest(body: unknown): ValidationResult {
  if (!isPlainObject(body)) return fail('Request body must be a JSON object.')
  if (unknownKeys(body, ['operation', 'text', 'settings', 'candidateCountOverride', 'extra'])) {
    return fail('Request body contains an unknown field.')
  }

  const { operation } = body
  if (typeof operation !== 'string' || !(OPERATIONS as readonly string[]).includes(operation)) {
    return fail(`operation must be one of: ${OPERATIONS.join(', ')}.`)
  }
  const textErr = checkText(body.text, 'text')
  if (textErr) return fail(textErr)

  // settings
  const settingsIn = body.settings === undefined ? {} : body.settings
  if (!isPlainObject(settingsIn)) return fail('settings must be an object.')
  if (unknownKeys(settingsIn, ['intensity', 'tone', 'domain', 'genre', 'audience'])) {
    return fail('settings contains an unknown field.')
  }
  const intensity = settingsIn.intensity === undefined ? 5 : settingsIn.intensity
  if (typeof intensity !== 'number' || !Number.isInteger(intensity) || intensity < MIN_INTENSITY || intensity > MAX_INTENSITY) {
    return fail(`settings.intensity must be an integer between ${MIN_INTENSITY} and ${MAX_INTENSITY}.`)
  }
  const tone = settingsIn.tone === undefined ? 'balanced' : settingsIn.tone
  if (typeof tone !== 'string' || !(TONES as readonly string[]).includes(tone)) {
    return fail(`settings.tone must be one of: ${TONES.join(', ')}.`)
  }
  const domain = settingsIn.domain === undefined ? 'general' : settingsIn.domain
  if (typeof domain !== 'string' || !(DOMAINS as readonly string[]).includes(domain)) {
    return fail(`settings.domain must be one of: ${DOMAINS.join(', ')}.`)
  }
  const genre = settingsIn.genre ?? null
  if (genre !== null && (typeof genre !== 'string' || !(GENRES as readonly string[]).includes(genre))) {
    return fail(`settings.genre must be null or one of: ${GENRES.join(', ')}.`)
  }
  const audience = settingsIn.audience ?? null
  if (audience !== null && (typeof audience !== 'string' || !(AUDIENCES as readonly string[]).includes(audience))) {
    return fail(`settings.audience must be null or one of: ${AUDIENCES.join(', ')}.`)
  }

  // candidateCountOverride
  const cco = body.candidateCountOverride ?? null
  if (cco !== null && (typeof cco !== 'number' || !Number.isInteger(cco) || cco < 1 || cco > MAX_CANDIDATE_OVERRIDE)) {
    return fail(`candidateCountOverride must be null or an integer between 1 and ${MAX_CANDIDATE_OVERRIDE}.`)
  }

  // extra
  const extraIn = body.extra === undefined ? {} : body.extra
  if (!isPlainObject(extraIn)) return fail('extra must be an object.')
  if (unknownKeys(extraIn, ['sourceText', 'tone', 'domain'])) return fail('extra contains an unknown field.')
  const extra: BenchmarkRequest['extra'] = {}
  if (extraIn.sourceText !== undefined) {
    const err = checkText(extraIn.sourceText, 'extra.sourceText')
    if (err) return fail(err)
    extra.sourceText = extraIn.sourceText as string
  }
  if (extraIn.tone !== undefined) {
    if (typeof extraIn.tone !== 'string' || !(TONES as readonly string[]).includes(extraIn.tone)) {
      return fail(`extra.tone must be one of: ${TONES.join(', ')}.`)
    }
    extra.tone = extraIn.tone
  }
  if (extraIn.domain !== undefined) {
    if (typeof extraIn.domain !== 'string' || !(DOMAINS as readonly string[]).includes(extraIn.domain)) {
      return fail(`extra.domain must be one of: ${DOMAINS.join(', ')}.`)
    }
    extra.domain = extraIn.domain
  }
  if (operation === 'repair_facts' && extra.sourceText === undefined) {
    return fail('extra.sourceText is required for repair_facts.')
  }

  return {
    ok: true,
    value: {
      operation: operation as BenchmarkOperation,
      text: body.text as string,
      settings: { intensity, tone, domain, genre, audience },
      candidateCountOverride: cco,
      extra,
    },
  }
}
