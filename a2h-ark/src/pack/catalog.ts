// The 17 tests of the benchmark, in order, and the manifest and catalog built from them.
import { KNOWN_CAPABILITIES, type JsonObject } from '@benchmarkr/core'
import { assertValidBenchmarkCatalog, assertValidBenchmarkManifest } from '@benchmarkr/contracts'
import { A2H_TEST_LABELS } from '../shared/types'
import { a2h01, a2h02 } from './defs-conversion'
import { a2h04, a2h05, a2h08, a2h09, a2h10, a2h13, a2h16 } from './defs-fixtures'
import { a2h06, a2h12 } from './defs-repair'
import { a2h07, a2h11, a2h14, a2h15 } from './defs-experiments'
import { a2h03, a2h17 } from './defs-rollups'
import { DETECTOR_CREDENTIAL_TYPE, DETECTOR_ROLE } from './detector'
import { CORPUS_INPUT, FIXTURES_INPUT } from './data'
import { COMPATIBILITY_KEY, CORPUS_KIND, FIXTURES_KIND, PACKAGE_ID, SCORING_VERSION, toJson, toJsonObject } from './util'
import type { Design, ResolvedOptions, TestDef } from './suite'

/** A2H-01 .. A2H-17, in order. */
export const TEST_DEFS: readonly TestDef[] = [
  a2h01, a2h02, a2h03, a2h04, a2h05, a2h06, a2h07, a2h08, a2h09, a2h10, a2h11, a2h12, a2h13, a2h14, a2h15, a2h16, a2h17,
]

export const defByCode = (code: string): TestDef | undefined => TEST_DEFS.find((d) => d.code === code)

const CATEGORIES = [
  { id: 'conversion', name: 'Conversion' },
  { id: 'preservation', name: 'Preservation' },
  { id: 'repair', name: 'Repair and grammar' },
  { id: 'experiments', name: 'Experiments' },
  { id: 'operations', name: 'Operations' },
]

/** The test-specific parameters that shape its trials: recorded in the catalog, hence in the package checksum. */
function parametersOf(def: TestDef, options: ResolvedOptions): JsonObject {
  switch (def.code) {
    case 'A2H-07':
      return toJsonObject({ repeatCount: options.repeatability.repeatCount, intensities: options.repeatability.intensities })
    case 'A2H-11':
      return toJsonObject({ contrasts: options.styleToneContrasts })
    case 'A2H-14':
      return toJsonObject({ contrasts: options.genreAudienceContrasts })
    case 'A2H-15':
      return toJsonObject({ intensities: options.candidateSelectionIntensities })
    case 'A2H-03':
    case 'A2H-17':
    case 'A2H-06':
    case 'A2H-12':
      return {}
    default:
      return toJsonObject({ intensities: options.intensities })
  }
}

function designJson(design: Design): JsonObject {
  return toJsonObject({ pool: design.pool, cohort: design.cohort, trialsPerItem: design.cells, ...(design.fixtureType === undefined ? {} : { fixtureType: design.fixtureType }) })
}

export function buildManifest(options: ResolvedOptions) {
  return assertValidBenchmarkManifest({
    packageId: PACKAGE_ID,
    name: 'Humanite A2H',
    version: options.version,
    frameworkApi: '>=1.0 <2.0',
    compatibilityKey: COMPATIBILITY_KEY,
    requiredCapabilities: [KNOWN_CAPABILITIES.STRUCTURED_TASK_EXECUTION],
    optionalCapabilities: [KNOWN_CAPABILITIES.USAGE_METRICS],
    categories: CATEGORIES,
    testCount: TEST_DEFS.length,
    serviceRoles: [
      {
        id: DETECTOR_ROLE,
        name: 'AI detector',
        purpose:
          'A GPTZero-compatible detector that scores every source text and every output for A2H-01, A2H-02, A2H-07 and A2H-15. Bind an API key (payload: token, and optionally baseUrl for a compatible service).',
        kind: 'detector',
        credentialTypes: [DETECTOR_CREDENTIAL_TYPE],
        // A manifest declares roles per package, not per test, so the detector is required even for a run of
        // fixture-only tests.
        required: true,
      },
    ],
    datasetInputs: [
      {
        id: CORPUS_INPUT,
        name: 'Corpus',
        purpose: 'The frozen source documents (domain x topic x length) every test is measured on.',
        kind: CORPUS_KIND,
        required: true,
      },
      {
        id: FIXTURES_INPUT,
        name: 'Fixtures',
        purpose:
          'Known-answer fixtures (citations, numbers, modality, protected terms, terminology, claim relationships, grammar and factual repair). Required by A2H-04, 05, 06, 09, 10, 12, 13 and 16; the other tests ignore it.',
        kind: FIXTURES_KIND,
        required: false,
      },
    ],
  })
}

export function buildCatalog(options: ResolvedOptions) {
  return assertValidBenchmarkCatalog({
    categories: CATEGORIES,
    tests: TEST_DEFS.map((def) => ({
      id: def.code,
      title: A2H_TEST_LABELS[def.code],
      categoryId: def.category,
      tags: [
        'a2h',
        def.defaultEnabled ? 'default' : 'optional',
        ...(def.experimental ? ['experimental'] : []),
        ...(def.needsDetector ? ['detector'] : []),
        ...(def.needsFixtures ? ['fixtures'] : []),
      ],
      requiredCapabilities: [KNOWN_CAPABILITIES.STRUCTURED_TASK_EXECUTION],
      defaultTrialCount: def.defaultTrialCount,
      timeoutMs: def.timeoutMs,
      metadata: toJson({
        description: def.description,
        defaultEnabled: def.defaultEnabled,
        experimental: def.experimental,
        requiresDetector: def.needsDetector,
        requiresFixtures: def.needsFixtures,
        scoring: SCORING_VERSION,
        design: designJson(def.design(options)),
        parameters: parametersOf(def, options),
      }),
    })),
  })
}
