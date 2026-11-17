import { createHash } from 'node:crypto'
import { embedMany } from 'ai'
import { searchWords } from '../../archive/query'
import { EMBEDDING_DIMENSIONS } from '../../db/schema'
import { embeddingModel, modelName, modelSetting } from '../ai/models'

export interface Embedded {
  /** One vector per text, in the order of the texts. */
  vectors: number[][]
  tokens: number
  /** As written in `.env`: provider:model. Stored with every vector. */
  model: string
}

/** Turns texts into vectors. The rest of the chat knows this function only, never a provider. */
export type Embedder = (texts: readonly string[]) => Promise<Embedded>

const FAKE_MODEL = 'fake:embedding'
/** Words are compared by their first letters, so "rozpočet" and "rozpočtu" land together. */
const FAKE_STEM_LETTERS = 5

/**
 * Vectors without a model, for the test suite: every word adds to one of the
 * dimensions, chosen by a hash of the word. Texts that share words come out
 * close, and the same text always gives the same vector.
 */
export const fakeEmbedder: Embedder = (texts) =>
  Promise.resolve({
    model: FAKE_MODEL,
    tokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
    vectors: texts.map((text) => {
      const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
      for (const word of searchWords(text, Infinity)) {
        const stem = word.slice(0, FAKE_STEM_LETTERS)
        const slot = createHash('sha256').update(stem).digest().readUInt32BE(0)
        const index = slot % EMBEDDING_DIMENSIONS
        vector[index] = (vector[index] ?? 0) + 1
      }
      const length = Math.hypot(...vector) || 1
      return vector.map((value) => value / length)
    }),
  })

const aiEmbedder: Embedder = async (texts) => {
  const { embeddings, usage } = await embedMany({ model: embeddingModel(), values: [...texts] })
  const wrong = embeddings.find((vector) => vector.length !== EMBEDDING_DIMENSIONS)
  if (wrong !== undefined) {
    throw new Error(
      `The embedding model gives ${wrong.length} numbers, the database holds ${EMBEDDING_DIMENSIONS}.`,
    )
  }
  return { vectors: embeddings, tokens: usage.tokens, model: modelName('embedding') }
}

export function getEmbedder(): Embedder {
  return modelSetting('embedding').provider === 'fake' ? fakeEmbedder : aiEmbedder
}
