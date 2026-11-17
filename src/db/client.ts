import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

export type Database = NodePgDatabase<typeof schema>

let pool: pg.Pool | undefined
let database: Database | undefined

export function readDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
  }
  return url
}

/** One pool per server process, opened on first use. */
export function getDatabase(): Database {
  if (database === undefined) {
    pool = new pg.Pool({ connectionString: readDatabaseUrl(), max: 5 })
    database = drizzle(pool, { schema })
  }
  return database
}

/** Commands call this at the end; an open pool keeps the process alive. */
export async function closeDatabase() {
  await pool?.end()
  pool = undefined
  database = undefined
}
