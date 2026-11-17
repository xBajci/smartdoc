import { hashPassword } from '../../src/server/session-password'

/** Password of the administrator in the test suite. */
export const TEST_PASSWORD = 'zkusebni-heslo'

const server = process.env.E2E_DATABASE_SERVER ?? 'postgres://postgres:postgres@localhost:5434'

export const DATABASE_SERVER_URL = `${server}/postgres`
export const DATABASE_NAME = 'hm_archiv_e2e'
export const DATABASE_URL = `${server}/${DATABASE_NAME}`
export const STORAGE_DIR = '.data/e2e-storage'

/** What the application under test runs with. Never the developer's own `.env`. */
export function serverEnvironment(port: number): Record<string, string> {
  return {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL,
    STORAGE_DIR,
    SESSION_SECRET: 'e2e-only-session-secret-not-used-anywhere-else',
    ADMIN_PASSWORD_HASH: hashPassword(TEST_PASSWORD),
    // Local storage even if the developer's shell carries a blob token.
    BLOB_READ_WRITE_TOKEN: '',
    // Fixed answers instead of a real model: tests cost nothing and repeat exactly.
    AI_OCR_MODEL: 'fake:test',
    AI_DESCRIPTION_MODEL: 'fake:description',
    // 1000 tokens in and 100 out per call: $0.0012 for the first model, $0.0024 for the second.
    // The chat answers by quoting the best piece; vectors are made from the words of a text.
    AI_CHAT_MODEL: 'fake:chat',
    AI_EMBEDDING_MODEL: 'fake:embedding',
    // Weights from whether the query has a digit; scores from the words a piece shares with it.
    AI_DECISION_MODEL: 'fake:decision',
    CHAT_DAILY_LIMIT: '50',
    CHAT_HOURLY_LIMIT: '40',
    AI_PRICES:
      '{"fake:test":[1,2],"fake:description":[2,4],"fake:chat":[1,2],"fake:embedding":[1,0],"fake:decision":[1,0]}',
  }
}
