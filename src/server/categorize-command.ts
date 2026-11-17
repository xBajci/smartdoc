import { and, eq, ne } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../db/client'
import { documents } from '../db/schema'
import { getCategorizer } from './ai/categorizer'
import { categorizeDocument } from './processing'

// `pnpm categories:assign` — lets the decision model pick a category for every
// processed document that nobody filed yet, from the text it already has.
// `--all` asks again for every document whose category the administrator did not choose.
const everything = process.argv.includes('--all')
const database = getDatabase()

if (getCategorizer() === null) {
  console.error('The decision model is not set up: see AI_DECISION_MODEL and its key in .env.')
  process.exitCode = 1
} else {
  const waiting = await database
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.status, 'ready'),
        everything
          ? ne(documents.categorySource, 'manual')
          : eq(documents.categorySource, 'default'),
      ),
    )
    .orderBy(documents.title)

  for (const document of waiting) {
    const category = await categorizeDocument(document.id)
    console.log(`${document.title}: ${category ?? 'beze změny'}`)
  }
  console.log(`Hotovo. Dokumentů: ${waiting.length}.`)
}
await closeDatabase()
