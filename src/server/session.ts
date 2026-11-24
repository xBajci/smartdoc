import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  deleteCookie,
  getCookie,
  getRequestIP,
  getRequestProtocol,
  setCookie,
} from '@tanstack/react-start/server'
import { and, count, eq, gt, lt } from 'drizzle-orm'
import { MAX_FAILED_SIGN_INS, SIGN_IN_LOCK_MINUTES } from '../admin/limits'
import { getDatabase } from '../db/client'
import { loginAttempts } from '../db/schema'
import { adminPasswordHash, sessionSecret } from './config'
import { verifyPassword } from './session-password'

const COOKIE_NAME = 'archiv_sprava'
const SESSION_HOURS = 12

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('hex')
}

/** The cookie carries only its own expiry and a signature — there is a single administrator. */
function sessionIsValid(cookie: string | undefined): boolean {
  if (cookie === undefined) return false
  const [expires, signature] = cookie.split('.')
  if (expires === undefined || signature === undefined) return false
  const expected = Buffer.from(sign(expires))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false
  return Number(expires) > Date.now()
}

export function isAdmin(): boolean {
  return sessionIsValid(getCookie(COOKIE_NAME))
}

export class NotSignedInError extends Error {
  constructor() {
    super('Administrator session is required.')
  }
}

export function requireAdmin() {
  if (!isAdmin()) throw new NotSignedInError()
}

/**
 * Makes the work of a server function the administrator's: a visitor's call
 * is refused before the work starts. Every server function that is not open
 * to visitors is wrapped in this or in `adminOrNull`; a test checks that none
 * is left out (`functions.test.ts`).
 */
export function forAdmin<Input, Result>(work: (input: Input) => Result) {
  return (input: Input): Result => {
    requireAdmin()
    return work(input)
  }
}

/**
 * The same for what a page of the administration loads first: a visitor gets
 * `null`, so the page can show the sign-in form instead of an error.
 */
export function adminOrNull<Input, Result>(work: (input: Input) => Promise<Result>) {
  return async (input: Input): Promise<Result | null> => (isAdmin() ? work(input) : null)
}

/** Stands for the caller's address without keeping the address itself. */
export function clientKey() {
  const address = getRequestIP({ xForwardedFor: true }) ?? 'unknown'
  return createHash('sha256').update(`${sessionSecret()}:${address}`).digest('hex')
}

export type SignInResult = 'ok' | 'wrong' | 'locked'

export async function signIn(password: string): Promise<SignInResult> {
  const database = getDatabase()
  const ipHash = clientKey()
  const windowStart = new Date(Date.now() - SIGN_IN_LOCK_MINUTES * 60_000)

  await database.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, windowStart))
  const [recent] = await database
    .select({ total: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ipHash, ipHash), gt(loginAttempts.attemptedAt, windowStart)))
  if ((recent?.total ?? 0) >= MAX_FAILED_SIGN_INS) return 'locked'

  if (!verifyPassword(password, adminPasswordHash())) {
    await database.insert(loginAttempts).values({ ipHash })
    return (recent?.total ?? 0) + 1 >= MAX_FAILED_SIGN_INS ? 'locked' : 'wrong'
  }

  await database.delete(loginAttempts).where(eq(loginAttempts.ipHash, ipHash))
  const expires = String(Date.now() + SESSION_HOURS * 3_600_000)
  setCookie(COOKIE_NAME, `${expires}.${sign(expires)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestProtocol({ xForwardedProto: true }) === 'https',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  })
  return 'ok'
}

export function signOut() {
  deleteCookie(COOKIE_NAME, { path: '/' })
}
