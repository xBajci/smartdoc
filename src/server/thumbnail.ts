import sharp from 'sharp'

/** Longest side of a thumbnail in pixels: enough for a preview card on a dense screen. */
export const THUMBNAIL_SIZE = 640

/**
 * A small WebP copy of an image. `rotate()` applies the camera's orientation,
 * so a portrait photograph is not shown lying on its side. Returns `null` when
 * the picture cannot be decoded — the document is still kept, just without one.
 */
export async function makeThumbnail(original: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(original, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
  } catch {
    return null
  }
}
