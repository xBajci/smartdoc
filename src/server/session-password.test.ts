import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './session-password'

describe('administrator password', () => {
  it('accepts the password it was made from and nothing else', () => {
    const stored = hashPassword('správné heslo')
    expect(verifyPassword('správné heslo', stored)).toBe(true)
    expect(verifyPassword('jiné heslo', stored)).toBe(false)
  })

  it('never stores the password itself', () => {
    expect(hashPassword('tajemství')).not.toContain('tajemství')
  })

  it('refuses a stored value it does not understand', () => {
    expect(verifyPassword('cokoli', 'cokoli')).toBe(false)
  })
})
