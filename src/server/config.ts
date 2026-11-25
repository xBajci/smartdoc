/** Server-side settings read from the environment. Never import this from browser code. */

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Copy .env.example to .env.`)
  }
  return value
}

export function sessionSecret(): string {
  const secret = required('SESSION_SECRET')
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.')
  return secret
}

export function adminPasswordHash(): string {
  return required('ADMIN_PASSWORD_HASH')
}

/**
 * The token `pnpm skills:push` sends skill texts from their files with (see
 * `/api/skills`). Null when not set or shorter than 32 characters: the
 * endpoint is then switched off.
 */
export function skillsApiToken(): string | null {
  const token = process.env.SKILLS_API_TOKEN?.trim() ?? ''
  return token.length >= 32 ? token : null
}

export interface S3Settings {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** `https://host/bucket/key` instead of `https://bucket.host/key`; MinIO needs it. */
  forcePathStyle: boolean
}

/** The S3-compatible store the files go to. Null when `S3_BUCKET` is not set. */
export function s3Settings(): S3Settings | null {
  const bucket = process.env.S3_BUCKET?.trim() ?? ''
  if (bucket === '') return null
  return {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    bucket,
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  }
}

/** Files go to the S3-compatible store when its bucket is named, otherwise to a local folder. */
export function storageMode(): 's3' | 'local' {
  return s3Settings() === null ? 'local' : 's3'
}

export function localStorageDirectory(): string {
  return process.env.STORAGE_DIR ?? '.data/storage'
}

/**
 * The public address of the site, e.g. `https://archiv.example.cz`, without a
 * trailing slash. Behind a proxy the application sees only the proxy's own
 * address, so links meant for the outside take this one. Null when not set.
 */
export function siteUrl(): string | null {
  const url = process.env.SITE_URL?.trim().replace(/\/+$/, '')
  return url ? url : null
}
