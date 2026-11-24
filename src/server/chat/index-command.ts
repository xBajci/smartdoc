import { randomUUID } from 'node:crypto'
import { eq, notExists, and } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../../db/client'
import { documentChunks, documents } from '../../db/schema'
import { storeCalls } from '../ai/calls'
import { hasTextLayer, readTextLayers } from '../pdf-text'
import { getStorage } from '../storage'
import type { PageText } from './chunks'
import { getEmbedder } from './embedder'
import { prepareChunks, writeChunks } from './index-service'

// `pnpm chat:index` — prepares for the chat every public document that has no
// pieces yet, i.e. one processed before the chat existed. Nothing is read by a
// model again: only the embedding is paid for. `--all` does every document anew.
const everything = process.argv.includes('--all')
const database = getDatabase()
const embed = getEmbedder()

const waiting = await database
  .select()
  .from(documents)
  .where(
    and(
      eq(documents.status, 'ready'),
      everything
        ? undefined
        : notExists(
            database
              .select({ id: documentChunks.id })
              .from(documentChunks)
              .where(eq(documentChunks.documentId, documents.id)),
          ),
    ),
  )

/**
 * The text page by page. A PDF whose every page has a text layer is read from
 * the file again, which costs nothing. Otherwise the stored text is used; it
 * does not say where a page ends, so its pieces carry no page number.
 */
async function pagesOf(row: (typeof waiting)[number]): Promise<PageText[]> {
  if (row.format === 'pdf') {
    const original = await getStorage().readAll(row.storageKey)
    const layers = original === null ? [] : await readTextLayers(original).catch(() => [])
    if (layers.length > 0 && layers.every(hasTextLayer)) {
      return layers.map((text, index) => ({ page: index + 1, text }))
    }
  }
  return [{ page: null, text: row.extractedText }]
}

let pieces = 0
for (const row of waiting) {
  const chunks = await prepareChunks(row, await pagesOf(row), embed)
  await database.transaction((transaction) => writeChunks(transaction, row.id, chunks.rows))
  if (chunks.call !== null) {
    await storeCalls(
      { runId: randomUUID(), documentId: row.id, title: row.title, format: row.format },
      [chunks.call],
    )
  }
  pieces += chunks.rows.length
  console.log(`${row.title}: ${chunks.rows.length}`)
}

await closeDatabase()
console.log(`Documents: ${waiting.length}, pieces: ${pieces}.`)
