import { closeDatabase, getDatabase } from './client'
import { migrateDatabase } from './migrate'

// `pnpm db:migrate` — idempotent.
await migrateDatabase(getDatabase())
await closeDatabase()
console.log('Migrated.')
