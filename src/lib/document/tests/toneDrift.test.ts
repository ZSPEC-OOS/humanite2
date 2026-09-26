import { describe, it, expect } from 'vitest'
import { detectToneDrift } from '../toneDrift'

describe('detectToneDrift', () => {
  it('reports no drift for a single chunk', () => {
    const report = detectToneDrift(["It's a short chunk, isn't it? It's fine."])
    expect(report.driftedChunkIndexes).toEqual([])
    expect(report.chunkDiagnostics).toHaveLength(1)
  })

  it('reports no drift when every chunk has a similar register', () => {
    const chunks = [
      "It's a fine day. We're doing well. It's all good.",
      "It's a nice time. We're on track. It's working out.",
      "It's steady progress. We're pleased. It's a solid result.",
    ]
    const report = detectToneDrift(chunks)
    expect(report.driftedChunkIndexes).toEqual([])
  })

  it('flags a chunk whose contraction rate deviates sharply from the rest', () => {
    const formalChunk = 'The organization shall not proceed without approval. It is required. It is expected.'
    const casualChunks = [
      "It's fine, isn't it? We're good. It's all set. Don't worry.",
      "It's great, isn't it? We're happy. It's a wrap. Don't stress.",
    ]
    const report = detectToneDrift([formalChunk, ...casualChunks])
    expect(report.driftedChunkIndexes).toContain(0)
  })

  it('returns one diagnostics entry per chunk, in order', () => {
    const report = detectToneDrift(['First chunk text.', 'Second chunk text.', 'Third chunk text.'])
    expect(report.chunkDiagnostics).toHaveLength(3)
  })
})
