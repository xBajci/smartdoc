import { asc, isNotNull } from 'drizzle-orm'
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

/** A file name far longer than a preview card is wide. */
export const LONG_FILENAME =
  'Zmena c. 2 UP Horni Mostenice - II. Oduvodneni zmeny uzemniho planu - navrh pro verejne projednani.pdf'

/** Adds one ready document named `Dlouhý název` whose file name is `LONG_FILENAME`. It has no file. */
export async function addLongNamedDocument() {
  await withDatabase((database) =>
    database.insert(schema.documents).values({
      id: 'dlouhy-nazev',
      originalFilename: LONG_FILENAME,
      title: 'Dlouhý název',
      titleSource: 'manual',
      format: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      sha256: 'dlouhy-nazev',
      storageKey: 'documents/dlouhy-nazev',
      categoryId: 'nezarazene',
      categorySource: 'manual',
      addedAt: new Date(Date.UTC(2020, 0, 1)),
      status: 'ready',
      hasText: true,
      pageCount: 1,
    }),
  )
}

/** The ids of every chat conversation that has a question, in no particular order. */
export async function chatConversationIds(): Promise<string[]> {
  return withDatabase(async (database) => {
    const rows = await database
      .selectDistinct({ conversationId: schema.chatTraces.conversationId })
      .from(schema.chatTraces)
    return rows.map((row) => row.conversationId)
  })
}

/** Removes every chat question, so every conversation id a browser still holds is unknown. */
export async function forgetChatTraces() {
  await withDatabase((database) => database.delete(schema.chatTraces))
}

/** What visitors said of the answers: the rated questions, oldest first. */
export async function chatFeedback(): Promise<{ question: string; helpful: boolean | null }[]> {
  return withDatabase((database) =>
    database
      .select({ question: schema.chatTraces.question, helpful: schema.chatTraces.helpful })
      .from(schema.chatTraces)
      .where(isNotNull(schema.chatTraces.helpful))
      .orderBy(asc(schema.chatTraces.createdAt)),
  )
}

/** The ids MLflow knows the chat questions by, oldest question first. */
export async function chatMlflowTraceIds(): Promise<(string | null)[]> {
  return withDatabase(async (database) => {
    const rows = await database
      .select({ id: schema.chatTraces.mlflowTraceId })
      .from(schema.chatTraces)
      .orderBy(asc(schema.chatTraces.createdAt))
    return rows.map((row) => row.id)
  })
}

/** Fills the day's allowance of chat questions, as if other visitors had asked them. */
export async function useUpChatAllowance(questions: number) {
  await withDatabase((database) =>
    database.insert(schema.chatTraces).values(
      Array.from({ length: questions }, (_, index) => ({
        id: `spent-${index}`,
        conversationId: `spent-${index}`,
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
