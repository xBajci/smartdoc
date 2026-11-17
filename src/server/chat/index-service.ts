import { eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { documentChunks } from '../../db/schema'
import { chunkPages, type PageText } from './chunks'
import type { Embedder } from './embedder'
import { chatSettings } from './settings'

export type ChunkRow = typeof documentChunks.$inferInsert

export interface PreparedChunks {
  rows: ChunkRow[]
  /** Tokens the embedding used and the model that made it; for the record of the call. */
  tokens: number
  model: string | null
}

/**
 * Cuts a document into pieces and has each embedded. Nothing is written yet,
 * so the slow part (the embedding) stays outside the database transaction.
 */
export async function prepareChunks(
  document: { id: string; title: string },
  pages: readonly PageText[],
  embed: Embedder,
): Promise<PreparedChunks> {
  const { chunkCharacters, chunkOverlap } = chatSettings()
  const chunks = chunkPages(pages, chunkCharacters, chunkOverlap)
  if (chunks.length === 0) return { rows: [], tokens: 0, model: null }
  // The name goes in front: a piece from the middle of a document does not say what it is from.
  const indexed = chunks.map((chunk) => `${document.title}\n${chunk.text}`)
  const { vectors, tokens, model } = await embed(indexed)
  return {
    tokens,
    model,
    rows: chunks.map((chunk, position) => ({
      documentId: document.id,
      page: chunk.page,
      position,
      text: chunk.text,
      indexed: indexed[position] ?? chunk.text,
      embedding: vectors[position] ?? null,
      embeddingModel: model,
    })),
  }
}

/** Rows written in one statement; a long document has hundreds of pieces. */
const INSERT_BATCH = 100

type Writer = Pick<Database, 'delete' | 'insert'>

/** Replaces all pieces of a document. Call it inside a transaction with the document's own update. */
export async function writeChunks(writer: Writer, documentId: string, rows: readonly ChunkRow[]) {
  await writer.delete(documentChunks).where(eq(documentChunks.documentId, documentId))
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    await writer.insert(documentChunks).values(rows.slice(start, start + INSERT_BATCH))
  }
}
