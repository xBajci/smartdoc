import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSearchQuestions, ranksOfDocuments } from './search-questions'

const questions = parseSearchQuestions(readFileSync('docs/tests/search-questions.md', 'utf8'))

describe('parseSearchQuestions', () => {
  it('reads all twenty questions in order', () => {
    expect(questions.map((item) => item.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
  })

  it('keeps the question as the visitor writes it', () => {
    expect(questions[0]).toMatchObject({
      name: 'Poplatek za psa',
      question: 'kolik se plati poplatek za psa',
    })
  })

  it('joins an answer and a trap that are wrapped onto the next lines', () => {
    expect(questions[2]?.answer).toBe(
      'Dotace 51 000 Kč od Olomouckého kraje v roce 2023. Celkové výdaje 112 206 Kč, vlastní zdroje 61 206 Kč.',
    )
    expect(questions[0]?.trap).toBe('bez diakritiky. Rušit může vyhláška o pohybu psů (č. 1/2013).')
  })

  it('joins a title that is wrapped onto the next line', () => {
    expect(questions[14]?.documents).toEqual([
      {
        title:
          'Obecně závazná vyhláška č. 1/2013 o pravidlech pro pohyb psů na veřejném prostranství',
        pages: '1',
      },
    ])
  })

  it('reads a list of several documents', () => {
    expect(questions[18]?.documents.map((item) => item.title)).toEqual([
      'Usnesení Rady obce č. 96/2026 ze dne 6. 5. 2026',
      'Usnesení Rady obce č. 97/2026 ze dne 18. 5. 2026',
      'Usnesení Rady obce č. 99/2026 ze dne 15. 6. 2026',
    ])
    expect(questions[1]?.documents[1]?.pages).toBe('2–3')
  })

  it('gives no documents to a question the archive cannot answer', () => {
    expect(questions[19]?.documents).toEqual([])
  })

  it('stops at a document without a page', () => {
    const broken =
      '### 1. A\n\n- **Otázka:** q\n- **Odpověď:** a\n- **Past:** p\n- **Správné dokumenty:** Some title\n'
    expect(() => parseSearchQuestions(broken)).toThrow('Question 1')
  })

  it('stops at a question without an answer', () => {
    const broken = '### 1. A\n\n- **Otázka:** q\n- **Past:** p\n- **Správné dokumenty:** žádné\n'
    expect(() => parseSearchQuestions(broken)).toThrow('Question 1')
  })
})

describe('ranksOfDocuments', () => {
  it('gives the place of the first piece of each document', () => {
    const pieces = [{ documentId: 'a' }, { documentId: 'b' }, { documentId: 'a' }]
    expect(ranksOfDocuments(pieces, ['a', 'b', 'c'])).toEqual([1, 2, null])
  })
})
