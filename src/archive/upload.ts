import type { DocumentFormat } from './types'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_BATCH_FILES = 20
export const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}

export interface DetectedFormat {
  format: DocumentFormat
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg'
}

/** How many leading bytes `detectFormat` needs. */
export const SIGNATURE_BYTES = 8

/** Recognises a file by its first bytes — the extension alone proves nothing. */
export function detectFormat(bytes: Uint8Array): DetectedFormat | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { format: 'pdf', mimeType: 'application/pdf' }
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { format: 'image', mimeType: 'image/png' }
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { format: 'image', mimeType: 'image/jpeg' }
  return null
}

export type UploadProblem = 'unsupported' | 'too-large' | 'empty'

export interface InspectedFile {
  detected: DetectedFormat | null
  sha256: string
  problem: UploadProblem | null
}

export async function inspectFile(file: File): Promise<InspectedFile> {
  const buffer = await file.arrayBuffer()
  const detected = detectFormat(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, SIGNATURE_BYTES)),
  )
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

  let problem: UploadProblem | null = null
  if (file.size === 0) problem = 'empty'
  else if (detected === null) problem = 'unsupported'
  else if (file.size > MAX_FILE_BYTES) problem = 'too-large'
  return { detected, sha256, problem }
}
