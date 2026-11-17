import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BlobNotFoundError, del, get, head, put } from '@vercel/blob'
import { localStorageDirectory, storageMode } from './config'

export interface StoredFile {
  body: ReadableStream<Uint8Array>
  size: number | null
}

/**
 * The one way this application talks to file storage. No other module may
 * import `@vercel/blob` or touch the storage folder. A `key` is whatever
 * `write` or an upload returned: a relative path locally, a blob address on Vercel.
 */
export interface FileStorage {
  write(pathname: string, body: Buffer, contentType: string): Promise<string>
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
function localStorage(): FileStorage {
  const root = resolve(localStorageDirectory())

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

/** Private blobs: a file is reachable only through this application. */
function blobStorage(): FileStorage {
  async function fetchBlob(key: string, headers?: HeadersInit) {
    try {
      const result = await get(key, { access: 'private', headers })
      return result === null || result.stream === null ? null : result
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  }

  return {
    async write(pathname, body, contentType) {
      const result = await put(pathname, body, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType,
      })
      return result.url
    },
    async read(key) {
      const result = await fetchBlob(key)
      return result === null ? null : { body: result.stream, size: result.blob.size }
    },
    async readAll(key) {
      const result = await fetchBlob(key)
      return result === null ? null : collect(result.stream)
    },
    async readStart(key, length) {
      const result = await fetchBlob(key, { range: `bytes=0-${length - 1}` })
      if (result === null) return null
      return new Uint8Array(await collect(result.stream, length)).subarray(0, length)
    },
    async size(key) {
      try {
        return (await head(key)).size
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null
        throw error
      }
    },
    async remove(key) {
      try {
        await del(key)
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) throw error
      }
    },
  }
}

let storage: FileStorage | undefined

export function getStorage(): FileStorage {
  storage ??= storageMode() === 'blob' ? blobStorage() : localStorage()
  return storage
}

/** Where a local upload of the document with this id is written. */
export function localOriginalKey(documentId: string) {
  return `documents/${documentId}`
}

/** Streams a request body to the local storage folder; used by the local upload route. */
export async function writeLocalStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<'ok' | 'too-large'> {
  const root = resolve(localStorageDirectory())
  const path = resolve(root, key)
  if (!path.startsWith(root + sep)) throw new Error('Storage key is outside the storage folder.')
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
    await pipeline(Readable.fromWeb(body.pipeThrough(limited) as never), createWriteStream(path))
    return 'ok'
  } catch (error) {
    await rm(path, { force: true })
    if (tooLarge) return 'too-large'
    throw error
  }
}
