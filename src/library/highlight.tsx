import type { ReactNode } from 'react'
import { normalizeText, searchWords } from '~/archive/query'

/**
 * Marks the searched words inside a text so a result shows why it matched.
 * Works character by character, so positions agree with the original text
 * even though the comparison ignores diacritics.
 */
export function highlight(text: string, query: string | undefined): ReactNode {
  const words = searchWords(query)
  if (words.length === 0) return text

  const characters = Array.from(text)
  const plain = characters.map((character) => normalizeText(character).charAt(0) || ' ')
  const marked = characters.map(() => false)
  const joined = plain.join('')
  for (const word of words) {
    for (let at = joined.indexOf(word); at !== -1; at = joined.indexOf(word, at + 1)) {
      for (let index = at; index < at + word.length; index += 1) marked[index] = true
    }
  }

  const parts: ReactNode[] = []
  let start = 0
  for (let index = 1; index <= characters.length; index += 1) {
    if (index === characters.length || marked[index] !== marked[start]) {
      const piece = characters.slice(start, index).join('')
      parts.push(marked[start] === true ? <mark key={start}>{piece}</mark> : piece)
      start = index
    }
  }
  return parts
}
