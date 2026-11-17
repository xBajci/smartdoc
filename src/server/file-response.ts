import { findDocumentRow } from './archive-service'
import { isAdmin } from './session'
import { getStorage } from './storage'

/** Only a published document, or any document for the administrator. */
async function readableDocument(id: string) {
  const row = await findDocumentRow(id)
  if (row === undefined) return null
  if (row.status !== 'ready' && !isAdmin()) return null
  return row
}

const notFound = () => new Response('Not found', { status: 404 })

function fileHeaders(contentType: string, size: number | null) {
  const headers = new Headers({
    'Content-Type': contentType,
    // Stored files are shown, never run: no script and no guessing of another type.
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=300',
  })
  if (size !== null) headers.set('Content-Length', String(size))
  return headers
}

/** RFC 5987 form, so a Czech file name survives the header. */
function disposition(kind: 'inline' | 'attachment', filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function serveOriginal(id: string, download: boolean): Promise<Response> {
  const document = await readableDocument(id)
  if (document === null) return notFound()
  const file = await getStorage().read(document.storageKey)
  if (file === null) return notFound()
  const headers = fileHeaders(document.mimeType, file.size)
  headers.set(
    'Content-Disposition',
    disposition(download ? 'attachment' : 'inline', document.originalFilename),
  )
  return new Response(file.body, { headers })
}

export async function serveThumbnail(id: string): Promise<Response> {
  const document = await readableDocument(id)
  if (document === null || document.thumbnailKey === null) return notFound()
  const file = await getStorage().read(document.thumbnailKey)
  if (file === null) return notFound()
  return new Response(file.body, { headers: fileHeaders('image/webp', file.size) })
}
