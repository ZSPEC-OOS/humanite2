import type { FidelityFact } from '../types'

// Requires a 'v' prefix, an explicit trigger word ("firmware 2.1"), or 3+
// dot-separated segments (2.3.1) — deliberately narrower than "any decimal
// number" so this doesn't redundantly re-flag every plain quantity
// quantities.ts already covers (a p-value like "0.05" is not a version).
const VERSION_RE =
  /\bv\.?\s?\d+(?:\.\d+){1,3}\b|\b\d+(?:\.\d+){2,}\b|\b(?:version|firmware|release|build)\s+\d+(?:\.\d+)+\b/gi

// A capitalized entity phrase (1-3 Title Case words) — the same shape as
// preprocess.ts's PROPER_NOUN_RE but permitting a trailing digit/single
// letter as the last token ("Server Alpha", "Model 3"), since a version
// number's bound entity is often exactly that kind of short label.
const ENTITY_RE =
  /\b(?!(?:The|A|An|This|That|These|Those|It|In|On|At|As|But|And|So|However|If|When|While|There|Here)\s)[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z0-9]*){0,2}\b/g

// A version number swapped between two entities within the same sentence
// ("Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.") is
// invisible to plain presence checks — both version strings still appear
// somewhere in the output. Binds each version to the nearest entity phrase
// within the same clause (split on ';', since a single sentence commonly
// joins two independent statements that way), searching BOTH directions —
// "Model A ships with version 4.2.0" and "Version 4.2.0 comes pre-installed
// on Model A" bind the same way, so a correct rewrite that reorders which
// side the entity falls on doesn't read as a changed binding.
export function extractVersionNumbers(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  const clauses = sentence.split(';').map(c => c.trim()).filter(Boolean)

  for (const clause of clauses) {
    const entityMatches = [...clause.matchAll(ENTITY_RE)]
    for (const versionMatch of clause.matchAll(VERSION_RE)) {
      let nearestEntity: string | null = null
      let nearestDistance = Infinity
      for (const entityMatch of entityMatches) {
        const distance = entityMatch.index! < versionMatch.index!
          ? versionMatch.index! - (entityMatch.index! + entityMatch[0].length)
          : entityMatch.index! - (versionMatch.index! + versionMatch[0].length)
        if (distance >= 0 && distance < nearestDistance) {
          nearestDistance = distance
          nearestEntity = entityMatch[0]
        }
      }
      facts.push({
        type: 'version',
        sentenceIndex,
        text: versionMatch[0],
        data: {
          entity: nearestEntity ? nearestEntity.toLowerCase() : null,
          version: versionMatch[0].toLowerCase().replace(/\s+/g, ' '),
        },
      })
    }
  }
  return facts
}
