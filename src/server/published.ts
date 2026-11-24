import { eq, type SQL } from 'drizzle-orm'
import { isPublished } from '../archive/types'
import { documents } from '../db/schema'

/**
 * Which documents a visitor may see. This is the one place on the server that
 * knows it: a document is published when its processing ended well. Every
 * list, the feed, the files and the chat ask here, so a change of the rule
 * reaches all of them at once.
 */
export { isPublished }

/** The published documents, as a condition of a query over `documents`. */
export function published(): SQL {
  return eq(documents.status, 'ready')
}

/**
 * The documents a reader may see: all for the administrator, the published
 * ones otherwise. For reading only: no condition means every row, which an
 * update or a removal must never get from here.
 */
export function visibleTo(administrator: boolean): SQL | undefined {
  return administrator ? undefined : published()
}
