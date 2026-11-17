import { count } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Database } from './client'
import { defaultCategories } from './default-categories'
import { categories } from './schema'

/** Applies every pending migration and makes sure the default categories exist. */
export async function migrateDatabase(database: Database, migrationsFolder = './drizzle') {
  await migrate(database, { migrationsFolder })
  await ensureDefaultCategories(database)
}

/** A fresh archive starts with the categories from the brief; an existing one is left alone. */
export async function ensureDefaultCategories(database: Database) {
  const [existing] = await database.select({ total: count() }).from(categories)
  if ((existing?.total ?? 0) > 0) return
  await database
    .insert(categories)
    .values(defaultCategories.map((category, position) => ({ ...category, position })))
}
