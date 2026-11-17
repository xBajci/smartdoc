import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** Stored form: `scrypt:<salt hex>:<hash hex>`. Made by `pnpm admin:password`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':')
  if (scheme !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}
