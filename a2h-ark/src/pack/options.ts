// Resolution and validation of the package options (the design parameters of the tests).
import { INITIAL_STYLE_TONE_CONTRASTS, validateStyleToneContrasts } from '../scoring/a2h11'
import { INITIAL_GENRE_AUDIENCE_CONTRASTS, validateGenreAudienceContrasts } from '../scoring/a2h14'
import { candidateCountForIntensity } from '../vendor/selection/candidates'
import { configError, toJson } from './util'
import { MAIN_INTENSITIES, type PackOptions, type ResolvedOptions } from './suite'

function intensityList(value: readonly number[], what: string): number[] {
  if (value.length === 0) throw configError(`${what} must not be empty`)
  for (const v of value) {
    if (!Number.isInteger(v) || v < 1 || v > 10) throw configError(`${what} must be integers from 1 to 10`)
  }
  return [...new Set(value)].sort((a, b) => a - b)
}

export function resolveOptions(options: PackOptions = {}): ResolvedOptions {
  const intensities = intensityList(options.intensities ?? MAIN_INTENSITIES, 'intensities')
  const repeat = options.repeatability ?? { repeatCount: 5, intensities: [3, 6, 9] }
  if (!Number.isInteger(repeat.repeatCount) || repeat.repeatCount < 2 || repeat.repeatCount > 50) {
    throw configError('repeatability.repeatCount must be an integer from 2 to 50')
  }
  const tone = validateStyleToneContrasts(toJson(options.styleToneContrasts ?? INITIAL_STYLE_TONE_CONTRASTS))
  if ('error' in tone) throw configError(tone.error)
  const genre = validateGenreAudienceContrasts(toJson(options.genreAudienceContrasts ?? INITIAL_GENRE_AUDIENCE_CONTRASTS))
  if ('error' in genre) throw configError(genre.error)
  // Only intensities that run candidate search have a meaningful production arm.
  const candidate = intensityList(options.candidateSelectionIntensities ?? [5, 8], 'candidateSelectionIntensities').filter((i) => candidateCountForIntensity(i) > 1)
  if (candidate.length === 0) throw configError('candidateSelectionIntensities needs an intensity of 4 or more')
  return {
    version: options.version ?? '1.0.0',
    intensities,
    repeatability: { repeatCount: repeat.repeatCount, intensities: intensityList(repeat.intensities, 'repeatability.intensities') },
    styleToneContrasts: tone.contrasts,
    genreAudienceContrasts: genre.contrasts,
    candidateSelectionIntensities: candidate,
  }
}
