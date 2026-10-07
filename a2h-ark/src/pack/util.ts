// Small helpers shared by the pack: JSON coercion, type guards and the identifiers every pack module agrees on.
import { FrameworkError, type JsonObject, type JsonValue } from '@benchmarkr/core'

export const PACK_ID = 'com.humanite.a2h'
export const PACK_VERSION = '1.0.0'
export const ADAPTER_ID = 'com.humanite.a2h-target'
export const PACKAGE_ID = 'com.humanite.a2h'
export const COMPATIBILITY_KEY = 'a2h-v1'
/** Recorded in every scored result; bump it (and the package version) when a change alters what a result means. */
export const SCORING_VERSION = 'a2h-pack/scoring-v1'

/** The dataset kinds the ark's generator spec and export tool produce (see src/generator-specs). */
export const CORPUS_KIND = 'a2h-corpus'
export const FIXTURES_KIND = 'a2h-fixtures'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const finiteOrNull = (value: unknown): number | null => finite(value) ?? null

/**
 * A deep copy that is guaranteed JSON-safe: `undefined` properties vanish, NaN and Infinity become null,
 * exactly as persistence would store them, so what scoring computes is what aggregation later reads.
 */
export function toJson<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value === undefined ? null : value)) as JsonValue
}

export function toJsonObject(value: unknown): JsonObject {
  const json = toJson(value)
  if (!isRecord(json)) throw new FrameworkError('FRAMEWORK_CONFIG', 'Expected a JSON object')
  return json as JsonObject
}

export function configError(message: string, details?: JsonObject): FrameworkError {
  return new FrameworkError('FRAMEWORK_CONFIG', message, details === undefined ? {} : { details })
}
