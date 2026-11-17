import { describe, expect, it } from 'vitest'
import { titleFromFilename } from './title'

describe('titleFromFilename', () => {
  it('drops only the extension', () => {
    expect(titleFromFilename('zapis.3.2026.pdf')).toBe('zapis.3.2026')
  })
})
