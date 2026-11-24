/**
 * Checks of what a browser sent to a server function. A server function
 * trusts nothing it receives: every value passes one of these, or the call
 * is refused.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const SHA256 = /^[0-9a-f]{64}$/
export const HEX_COLOR = /^#[0-9a-f]{6}$/

export function text(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('Invalid input.')
  return value
}

export function matching(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Invalid input.')
  return value
}

/** A list of short texts, e.g. the places of a skill. */
export function texts(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('Invalid input.')
  return value.map((item) => text(item, 200))
}
