import type { CorpusItem, Domain } from '../types'
import { GENERAL_CORPUS } from './general'
import { ACADEMIC_CORPUS } from './academic'
import { BUSINESS_CORPUS } from './business'
import { TECHNICAL_CORPUS } from './technical'
import { MEDICAL_CORPUS } from './medical'
import { LEGAL_CORPUS } from './legal'

// 10 source documents per domain × 6 domains = 60, per the Phase 2 spec.
export const CORPUS: CorpusItem[] = [
  ...GENERAL_CORPUS,
  ...ACADEMIC_CORPUS,
  ...BUSINESS_CORPUS,
  ...TECHNICAL_CORPUS,
  ...MEDICAL_CORPUS,
  ...LEGAL_CORPUS,
]

export function corpusByDomain(domain: Domain): CorpusItem[] {
  return CORPUS.filter(item => item.domain === domain)
}
