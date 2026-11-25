import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { localStorageDirectory, s3Settings, type S3Settings } from './config'

export interface StoredFile {
  body: ReadableStream<Uint8Array>
  size: number | null
}

/** What is known about a body that is stored as it arrives. */
export interface IncomingBody {
  /** The length the sender declared; null when it gave none. */
  length: number | null
  maxBytes: number
}

/**
 * The one way this application talks to file storage. No other module may
 * import `@aws-sdk/client-s3` or touch the storage folder. A `key` is the
 * relative path a file was written under, the same in both kinds of storage.
 */
export interface FileStorage {
  write(pathname: string, body: Buffer, contentType: string): Promise<string>
  /** Stores a request body without holding all of it in memory. Nothing is left behind when it is too large. */
  writeStream(
    pathname: string,
    body: ReadableStream<Uint8Array>,
    incoming: IncomingBody,
  ): Promise<'ok' | 'too-large'>
  read(key: string): Promise<StoredFile | null>
  readAll(key: string): Promise<Buffer | null>
  /** The first bytes of a file — enough to recognise its format. */
  readStart(key: string, length: number): Promise<Uint8Array | null>
  size(key: string): Promise<number | null>
  /** A key that is already gone is success, so a repeated removal cannot get stuck. */
  remove(key: string): Promise<void>
}

async function collect(stream: ReadableStream<Uint8Array>, limit = Infinity): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  while (total < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  await reader.cancel().catch(() => undefined)
  return Buffer.concat(chunks)
}

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Files in a folder on this machine: development and the test suite. */
export function localStorage(directory = localStorageDirectory()): FileStorage {
  const root = resolve(directory)

  function pathOf(key: string) {
    const path = resolve(root, key)
    // A key never leaves the storage folder, whatever it contains.
    if (!path.startsWith(root + sep)) throw new Error('Storage key is outside the storage folder.')
    return path
  }

  return {
    async write(pathname, body) {
      const path = pathOf(pathname)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      return pathname
    },
    async writeStream(pathname, body, { maxBytes }) {
      const path = pathOf(pathname)
      await mkdir(dirname(path), { recursive: true })

      let written = 0
      let tooLarge = false
      const limited = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          written += chunk.byteLength
          if (written > maxBytes) {
            tooLarge = true
            controller.error(new Error('Upload is larger than the limit.'))
            return
          }
          controller.enqueue(chunk)
        },
      })
      try {
        await pipeline(
          Readable.fromWeb(body.pipeThrough(limited) as never),
          createWriteStream(path),
        )
        return 'ok'
      } catch (error) {
        await rm(path, { force: true })
        if (tooLarge) return 'too-large'
        throw error
      }
    },
    async read(key) {
      try {
        const path = pathOf(key)
        const { size } = await stat(path)
        const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
        return { body, size }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async readAll(key) {
      try {
        return await readFile(pathOf(key))
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async readStart(key, length) {
      try {
        const file = await open(pathOf(key), 'r')
        try {
          const buffer = new Uint8Array(length)
          const { bytesRead } = await file.read(buffer, 0, length, 0)
          return buffer.subarray(0, bytesRead)
        } finally {
          await file.close()
        }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async size(key) {
      try {
        return (await stat(pathOf(key))).size
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async remove(key) {
      await rm(pathOf(key), { force: true })
    },
  }
}

/** S3 answers a missing object with one of these two names, by the kind of request. */
function isGone(error: unknown) {
  return (
    error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.name === 'NotFound')
  )
}

/** A private bucket of an S3-compatible store: a file is reachable only through this application. */
export function s3Storage(settings: S3Settings): FileStorage {
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    // The newer checksum headers are an AWS feature; another store need not know them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  const at = (key: string) => ({ Bucket: settings.bucket, Key: key })

  async function fetchObject(key: string, range?: string) {
    try {
      const result = await client.send(new GetObjectCommand({ ...at(key), Range: range }))
      return result.Body === undefined ? null : { ...result, Body: result.Body }
    } catch (error) {
      if (isGone(error)) return null
      throw error
    }
  }

  return {
    async write(pathname, body, contentType) {
      await client.send(
        new PutObjectCommand({ ...at(pathname), Body: body, ContentType: contentType }),
      )
      return pathname
    },
    async writeStream(pathname, body, { length, maxBytes }) {
      if (length === null) {
        // S3 has to know the length before the first byte, so this body waits in memory.
        const whole = await collect(body, maxBytes + 1)
        if (whole.byteLength > maxBytes) return 'too-large'
        await client.send(new PutObjectCommand({ ...at(pathname), Body: whole }))
        return 'ok'
      }
      if (length > maxBytes) return 'too-large'
      // The declared length is safe to trust: the store refuses a body of another length.
      await client.send(
        new PutObjectCommand({
          ...at(pathname),
          Body: Readable.fromWeb(body as never),
          ContentLength: length,
        }),
      )
      return 'ok'
    },
    async read(key) {
      const result = await fetchObject(key)
      if (result === null) return null
      return { body: result.Body.transformToWebStream(), size: result.ContentLength ?? null }
    },
    async readAll(key) {
      const result = await fetchObject(key)
      return result === null ? null : Buffer.from(await result.Body.transformToByteArray())
    },
    async readStart(key, length) {
      try {
        const result = await fetchObject(key, `bytes=0-${length - 1}`)
        return result === null ? null : await result.Body.transformToByteArray()
      } catch (error) {
        // An empty file has no first byte to give.
        if (error instanceof S3ServiceException && error.name === 'InvalidRange') {
          return new Uint8Array()
        }
        throw error
      }
    },
    async size(key) {
      try {
        return (await client.send(new HeadObjectCommand(at(key)))).ContentLength ?? null
      } catch (error) {
        if (isGone(error)) return null
        throw error
      }
    },
    async remove(key) {
      // The store itself answers a missing key with success.
      await client.send(new DeleteObjectCommand(at(key)))
    },
  }
}

let storage: FileStorage | undefined

export function getStorage(): FileStorage {
  if (storage === undefined) {
    const settings = s3Settings()
    storage = settings === null ? localStorage() : s3Storage(settings)
  }
  return storage
}

/** Where the original of the document with this id is stored. */
export function originalKey(documentId: string) {
  return `documents/${documentId}`
}
