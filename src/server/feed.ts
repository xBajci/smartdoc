import { desc, eq } from 'drizzle-orm'
import { cs } from '../copy/cs'
import { getDatabase } from '../db/client'
import { categories, documents } from '../db/schema'

/** Documents the feed lists: the most recently added ones. */
export const FEED_ITEMS = 50

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The RSS feed of the archive: one item for every public document, newest
 * added first. A reader's program asks for it again and again, so a document
 * shows there as soon as its processing ends well. `origin` is the address the
 * feed was asked at, e.g. `https://archiv.example.cz`.
 */
export async function buildFeed(origin: string): Promise<string> {
  const rows = await getDatabase()
    .select({
      id: documents.id,
      title: documents.title,
      customDescription: documents.customDescription,
      shortDescription: documents.shortDescription,
      addedAt: documents.addedAt,
      category: categories.name,
    })
    .from(documents)
    .innerJoin(categories, eq(categories.id, documents.categoryId))
    // Only a document that is ready is public.
    .where(eq(documents.status, 'ready'))
    .orderBy(desc(documents.addedAt), desc(documents.id))
    .limit(FEED_ITEMS)

  const items = rows.map((row) => {
    const link = `${origin}/?doc=${encodeURIComponent(row.id)}`
    // The administrator's own description comes first, as in the library.
    const description = row.customDescription.trim() || row.shortDescription
    return [
      '    <item>',
      `      <title>${escapeXml(row.title)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(row.id)}</guid>`,
      `      <pubDate>${row.addedAt.toUTCString()}</pubDate>`,
      `      <category>${escapeXml(row.category)}</category>`,
      `      <description>${escapeXml(description)}</description>`,
      '    </item>',
    ].join('\n')
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(cs.brand.documentTitle)}</title>`,
    `    <link>${escapeXml(`${origin}/`)}</link>`,
    `    <description>${escapeXml(cs.feed.description)}</description>`,
    '    <language>cs</language>',
    `    <atom:link href="${escapeXml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    rows[0] === undefined
      ? null
      : `    <lastBuildDate>${rows[0].addedAt.toUTCString()}</lastBuildDate>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n')
}
