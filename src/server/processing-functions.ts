import { createServerFn } from '@tanstack/react-start'
import { findExtractedText } from './archive-service'
import { documentDebug } from './debug-service'
import { text } from './input'
import { processDocument } from './processing'
import { forAdmin } from './session'

/** What the browser calls on the server to process a document and to see how it went. */

/**
 * Reads the content of a stored document. The answer comes when processing
 * has ended, well or badly; the outcome is in the document's status.
 */
export const processDocumentFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(
    forAdmin(async ({ data }) => {
      await processDocument(data.id)
    }),
  )

export const getExtractedTextFn = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(forAdmin(({ data }) => findExtractedText(data.id)))

/** The processing of one document, step by step, for the debug panel. */
export const getDocumentDebugFn = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(forAdmin(({ data }) => documentDebug(data.id)))
