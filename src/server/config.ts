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

/** Files go to Vercel Blob when its token is present, otherwise to a local folder. */
export function storageMode(): 'blob' | 'local' {
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local'
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
