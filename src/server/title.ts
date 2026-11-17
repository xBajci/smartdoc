/** The display name a file has until processing gives it one from its content. */
export function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}
