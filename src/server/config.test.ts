import { afterEach, describe, expect, it, vi } from 'vitest'
import { siteUrl } from './config'

describe('siteUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is null when SITE_URL is missing or empty', () => {
    vi.stubEnv('SITE_URL', undefined)
    expect(siteUrl()).toBeNull()
    vi.stubEnv('SITE_URL', '  ')
    expect(siteUrl()).toBeNull()
  })

  it('drops trailing slashes, so a link never gets two', () => {
    vi.stubEnv('SITE_URL', 'https://archiv.example.cz/')
    expect(siteUrl()).toBe('https://archiv.example.cz')
    vi.stubEnv('SITE_URL', ' https://archiv.example.cz ')
    expect(siteUrl()).toBe('https://archiv.example.cz')
  })
})
