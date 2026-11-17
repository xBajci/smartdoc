/** A piece as one branch of the search ranked it; `rank` counts from one. */
export interface Ranked {
  chunkId: number
  rank: number
}

export interface Fused {
  chunkId: number
  wordRank: number | null
  meaningRank: number | null
  fusedScore: number
}

/**
 * Reciprocal rank fusion: a piece gets weight / (k + rank) from every branch that
 * found it. Only the order inside a branch counts, so a BM25 score and a
 * cosine distance never have to be compared with each other.
 */
export function fuseRanks(
  words: readonly Ranked[],
  meaning: readonly Ranked[],
  k: number,
  limit: number,
  weights: { words: number; meaning: number } = { words: 1, meaning: 1 },
): Fused[] {
  const fused = new Map<number, Fused>()
  const entry = (chunkId: number) => {
    let found = fused.get(chunkId)
    if (found === undefined) {
      found = { chunkId, wordRank: null, meaningRank: null, fusedScore: 0 }
      fused.set(chunkId, found)
    }
    return found
  }
  for (const { chunkId, rank } of words) {
    const item = entry(chunkId)
    item.wordRank = rank
    item.fusedScore += weights.words / (k + rank)
  }
  for (const { chunkId, rank } of meaning) {
    const item = entry(chunkId)
    item.meaningRank = rank
    item.fusedScore += weights.meaning / (k + rank)
  }
  return [...fused.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || a.chunkId - b.chunkId)
    .slice(0, limit)
}
