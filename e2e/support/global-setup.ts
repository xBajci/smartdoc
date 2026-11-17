import { prepareDatabase, resetArchive } from './database'

export default async function globalSetup() {
  await prepareDatabase()
  await resetArchive()
}
