import { hashPassword } from '../../src/server/session-password'
import { FAKE_MLFLOW_PORT } from './fake-mlflow'

/** Password of the administrator in the test suite. */
export const TEST_PASSWORD = 'zkusebni-heslo'

const server = process.env.E2E_DATABASE_SERVER ?? 'postgres://postgres:postgres@localhost:5434'

export const DATABASE_SERVER_URL = `${server}/postgres`
export const DATABASE_NAME = 'hm_archiv_e2e'
export const DATABASE_URL = `${server}/${DATABASE_NAME}`
export const STORAGE_DIR = '.data/e2e-storage'
/** Where the stand-in for MLflow listens, and what the application signs in to it with. */
export const MLFLOW_URL = `http://127.0.0.1:${FAKE_MLFLOW_PORT}`
export const MLFLOW_EXPERIMENT_ID = '7'
export const MLFLOW_AUTHORIZATION = `Basic ${Buffer.from('hm-archiv:e2e-mlflow-heslo').toString('base64')}`
/** The token `pnpm skills:push` sends skill texts with. */
export const SKILLS_API_TOKEN = 'e2e-only-skills-token-not-used-anywhere-else'
/** The public address the application under test believes it has. */
export const SITE_URL = 'https://archiv.example.cz'

/** What the application under test runs with. Never the developer's own `.env`. */
export function serverEnvironment(port: number): Record<string, string> {
  return {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL,
    STORAGE_DIR,
    // With a trailing slash on purpose: the application must not double it.
    SITE_URL: `${SITE_URL}/`,
    SESSION_SECRET: 'e2e-only-session-secret-not-used-anywhere-else',
    ADMIN_PASSWORD_HASH: hashPassword(TEST_PASSWORD),
    SKILLS_API_TOKEN,
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
    // Traces and feedback go to the stand-in for MLflow (e2e/support/fake-mlflow.ts).
    MLFLOW_TRACKING_URI: MLFLOW_URL,
    MLFLOW_EXPERIMENT_ID,
    MLFLOW_TRACKING_USERNAME: 'hm-archiv',
    MLFLOW_TRACKING_PASSWORD: 'e2e-mlflow-heslo',
    CHAT_DAILY_LIMIT: '50',
    CHAT_HOURLY_LIMIT: '40',
    AI_PRICES:
      '{"fake:test":[1,2],"fake:description":[2,4],"fake:chat":[1,2],"fake:embedding":[1,0],"fake:decision":[1,0]}',
  }
}
