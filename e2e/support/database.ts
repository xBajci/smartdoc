import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { resetWithDemo } from '../../src/db/demo'
import { migrateDatabase } from '../../src/db/migrate'
import * as schema from '../../src/db/schema'
import { fakeEmbedder } from '../../src/server/chat/embedder'
import { DATABASE_NAME, DATABASE_SERVER_URL, DATABASE_URL, STORAGE_DIR } from './environment'

async function withDatabase<T>(
  work: (database: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
) {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 })
  try {
    return await work(drizzle(pool, { schema }))
  } finally {
    await pool.end()
  }
}

/** Creates the test database when it is missing and brings its tables up to date. */
export async function prepareDatabase() {
  const admin = new pg.Client({ connectionString: DATABASE_SERVER_URL })
  await admin.connect()
  try {
    const existing = await admin.query('select 1 from pg_database where datname = $1', [
      DATABASE_NAME,
    ])
    if (existing.rowCount === 0) await admin.query(`create database ${DATABASE_NAME}`)
  } finally {
    await admin.end()
  }
  await withDatabase((database) => migrateDatabase(database))
}

/** Every test starts from the same demonstration archive. */
export async function resetArchive() {
  await withDatabase((database) => resetWithDemo(database, STORAGE_DIR, fakeEmbedder))
}

/**
 * Adds plain public documents named "Vyhláška č. 1" and on, older than every
 * demonstration document, so a list grows past one page. They have no file.
 */
export async function addDocuments(count: number) {
  await withDatabase((database) =>
    database.insert(schema.documents).values(
      Array.from({ length: count }, (_, index) => {
        const number = index + 1
        return {
          id: `vyhlaska-${number}`,
          originalFilename: `vyhlaska-${number}.pdf`,
          title: `Vyhláška č. ${number}`,
          titleSource: 'manual' as const,
          format: 'pdf' as const,
          mimeType: 'application/pdf',
          sizeBytes: 1000,
          sha256: `vyhlaska-${number}`,
          storageKey: `documents/vyhlaska-${number}`,
          categoryId: 'nezarazene',
          categorySource: 'manual' as const,
          // Number 1 is the newest of them.
          addedAt: new Date(Date.UTC(2020, 0, 100 - number)),
          status: 'ready' as const,
          hasText: true,
          pageCount: 1,
        }
      }),
    ),
  )
}

/** The ids of every chat session that has a question, in no particular order. */
export async function chatSessionIds(): Promise<string[]> {
  return withDatabase(async (database) => {
    const rows = await database
      .selectDistinct({ sessionId: schema.chatTraces.sessionId })
      .from(schema.chatTraces)
    return rows.map((row) => row.sessionId)
  })
}

/** Removes every chat question, so every session id a browser still holds is unknown. */
export async function forgetChatTraces() {
  await withDatabase((database) => database.delete(schema.chatTraces))
}

/** Fills the day's allowance of chat questions, as if other visitors had asked them. */
export async function useUpChatAllowance(questions: number) {
  await withDatabase((database) =>
    database.insert(schema.chatTraces).values(
      Array.from({ length: questions }, (_, index) => ({
        id: `spent-${index}`,
        sessionId: `spent-${index}`,
        question: 'Otázka jiného návštěvníka',
        scope: 'archive' as const,
        model: 'fake:chat',
        steps: [],
        setup: {},
        askerHash: `visitor-${index}`,
      })),
    ),
  )
}
