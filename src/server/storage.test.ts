import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { S3Settings } from './config'
import { localStorage, s3Storage, type FileStorage } from './storage'

/** The MinIO of docker-compose.yml (`pnpm db:up`). */
const minio: S3Settings = {
  endpoint: 'http://127.0.0.1:9100',
  region: 'us-east-1',
  bucket: 'hm-archiv-test',
  accessKeyId: 'minio',
  secretAccessKey: 'minio-local-only',
  forcePathStyle: true,
}

const minioRuns = await fetch(`${minio.endpoint}/minio/health/live`).then(
  (response) => response.ok,
  () => false,
)

function stream(bytes: Buffer) {
  return new Response(bytes.toString()).body as ReadableStream<Uint8Array>
}

async function text(body: ReadableStream<Uint8Array>) {
  return new Response(body).text()
}

/** Both kinds of storage must behave the same: the application never asks which one it has. */
function behavesAsStorage(open: () => FileStorage) {
  const folder = `test-${randomUUID()}`
  const key = (name: string) => `${folder}/${name}`
  const pdf = Buffer.from('%PDF-1.7 obsah dokumentu')

  it('gives back what was written, whole, as a stream and by its first bytes', async () => {
    const storage = open()
    expect(await storage.write(key('a.pdf'), pdf, 'application/pdf')).toBe(key('a.pdf'))

    expect(await storage.readAll(key('a.pdf'))).toEqual(pdf)
    expect(await storage.size(key('a.pdf'))).toBe(pdf.byteLength)
    const file = await storage.read(key('a.pdf'))
    expect(file?.size).toBe(pdf.byteLength)
    expect(file && (await text(file.body))).toBe(pdf.toString())
    const start = await storage.readStart(key('a.pdf'), 5)
    expect(start && Buffer.from(start).toString()).toBe('%PDF-')
  })

  it('overwrites a file written again under the same key', async () => {
    const storage = open()
    await storage.write(key('twice'), Buffer.from('first'), 'text/plain')
    await storage.write(key('twice'), Buffer.from('second'), 'text/plain')
    expect((await storage.readAll(key('twice')))?.toString()).toBe('second')
  })

  it('answers null for a file that is not there', async () => {
    const storage = open()
    expect(await storage.read(key('nothing'))).toBeNull()
    expect(await storage.readAll(key('nothing'))).toBeNull()
    expect(await storage.readStart(key('nothing'), 8)).toBeNull()
    expect(await storage.size(key('nothing'))).toBeNull()
  })

  it('has no first bytes to give for an empty file', async () => {
    const storage = open()
    await storage.write(key('empty'), Buffer.alloc(0), 'application/pdf')
    expect(await storage.size(key('empty'))).toBe(0)
    expect(await storage.readStart(key('empty'), 8)).toHaveLength(0)
  })

  it('removes a file, and removing it again is not an error', async () => {
    const storage = open()
    await storage.write(key('gone'), pdf, 'application/pdf')
    await storage.remove(key('gone'))
    expect(await storage.size(key('gone'))).toBeNull()
    await storage.remove(key('gone'))
  })

  it.each([
    ['with a declared length', pdf.byteLength],
    ['without a declared length', null],
  ])('stores a body as it arrives, %s', async (name, length) => {
    const storage = open()
    const result = await storage.writeStream(key(name), stream(pdf), { length, maxBytes: 100 })
    expect(result).toBe('ok')
    expect(await storage.readAll(key(name))).toEqual(pdf)
  })

  it.each([
    ['with a declared length', pdf.byteLength],
    ['without a declared length', null],
  ])('refuses a body over the limit and keeps nothing of it, %s', async (name, length) => {
    const storage = open()
    const result = await storage.writeStream(key(`big ${name}`), stream(pdf), {
      length,
      maxBytes: pdf.byteLength - 1,
    })
    expect(result).toBe('too-large')
    expect(await storage.size(key(`big ${name}`))).toBeNull()
  })
}

describe('local storage', () => {
  let directory = ''
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hm-archiv-storage-'))
  })
  afterAll(() => rm(directory, { recursive: true, force: true }))

  behavesAsStorage(() => localStorage(directory))

  it('never leaves its folder, whatever the key contains', async () => {
    await expect(localStorage(directory).readAll('../outside')).rejects.toThrow()
  })
})

// Skipped without the MinIO of docker-compose.yml: there is no other S3 store to ask.
describe.skipIf(!minioRuns)('S3 storage', () => {
  beforeAll(async () => {
    const client = new S3Client({
      endpoint: minio.endpoint,
      region: minio.region,
      forcePathStyle: true,
      credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: minio.secretAccessKey },
    })
    await client.send(new CreateBucketCommand({ Bucket: minio.bucket })).catch((error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'BucketAlreadyOwnedByYou') throw error
    })
  })

  behavesAsStorage(() => s3Storage(minio))
})
