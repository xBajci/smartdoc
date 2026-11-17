import { describe, expect, it } from 'vitest'
import { detectFormat } from './upload'

describe('detectFormat', () => {
  it('recognises the supported formats by their first bytes', () => {
    expect(detectFormat(new TextEncoder().encode('%PDF-1.7'))?.mimeType).toBe('application/pdf')
    expect(
      detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mimeType,
    ).toBe('image/png')
    expect(detectFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mimeType).toBe('image/jpeg')
  })

  it('refuses anything else, whatever the file is called', () => {
    expect(detectFormat(new TextEncoder().encode('PK\u0003\u0004 docx'))).toBeNull()
    expect(detectFormat(new Uint8Array())).toBeNull()
  })
})
