import type { ChatPassage, ChatSource } from '../../chat/types'

/**
 * Turns the model's marks into the visitor's: the model cites pieces by the
 * numbers the search gave them, the visitor sees sources numbered from one in
 * the order the answer uses them. Two pieces of the same page are one source.
 * A mark that points at no piece is removed.
 */
export function resolveCitations(
  text: string,
  passages: readonly ChatPassage[],
): { text: string; sources: ChatSource[] } {
  const byNumber = new Map(passages.map((passage) => [passage.number, passage]))
  const sources: ChatSource[] = []
  const numberOfPlace = new Map<string, number>()

  const renumbered = text.replace(/\[(\d+)\]/g, (_mark, digits: string) => {
    const passage = byNumber.get(Number(digits))
    if (passage === undefined) return ''
    const place = `${passage.documentId}#${passage.page ?? ''}`
    let number = numberOfPlace.get(place)
    if (number === undefined) {
      sources.push(
        passage.page === null
          ? { documentId: passage.documentId }
          : { documentId: passage.documentId, page: passage.page },
      )
      number = sources.length
      numberOfPlace.set(place, number)
    }
    return `[${number}]`
  })

  return {
    text: renumbered
      // The same source twice in a row says nothing more than once.
      .replace(/(\[\d+\])(\s*\1)+/g, '$1')
      .replace(/[ \t]+([.,;:!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
    sources,
  }
}
