/**
 * Colours of the index tabs the administrator can choose from. The last one is
 * the grey of the fallback category; the others are for the categories in front of it.
 */
export const CATEGORY_COLORS = [
  '#2c6e8f',
  '#8a5a1c',
  '#3c7a4c',
  '#a3426b',
  '#5a4fb0',
  '#b5622a',
  '#3f7f7b',
  '#74808a',
] as const

/** The colour a new category starts with: the colours in turn, grey left out. */
export function startColor(categoryCount: number): string {
  const lively = CATEGORY_COLORS.slice(0, -1)
  return lively[categoryCount % lively.length] ?? CATEGORY_COLORS[0]
}
