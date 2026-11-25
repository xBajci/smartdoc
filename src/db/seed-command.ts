import { getEmbedder } from '../server/chat/embedder'
import { localStorageDirectory, storageMode } from '../server/config'
import { closeDatabase, getDatabase } from './client'
import { resetWithDemo } from './demo'

// `pnpm db:seed` — REPLACES the whole archive with the demonstration documents.
if (storageMode() !== 'local') {
  console.error('Refused: the demonstration is only for local storage, not for an S3 bucket.')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refused: this command empties the archive.')
  process.exit(1)
}
await resetWithDemo(getDatabase(), localStorageDirectory(), getEmbedder())
await closeDatabase()
console.log('The archive now holds the demonstration documents.')
