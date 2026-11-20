import { describe, expect, it } from 'vitest'
import { QUESTIONS_FILE, recordOf, staleRecords } from './eval-dataset'
import type { SearchQuestion } from './search-questions'

const question: SearchQuestion = {
  number: 1,
  name: 'Poplatek za psa',
  question: 'kolik se plati poplatek za psa',
  answer: '200 Kč za každého psa za kalendářní rok.',
  trap: 'bez diakritiky.',
  documents: [{ title: 'Vyhláška o poplatku ze psů', pages: '2' }],
}

describe('recordOf', () => {
  it('gives the judges the question and the answer it expects', () => {
    expect(recordOf(question)).toEqual({
      inputs: { question: 'kolik se plati poplatek za psa' },
      expectations: {
        expected_response: '200 Kč za každého psa za kalendářní rok.',
        expected_documents: ['Vyhláška o poplatku ze psů, s. 2'],
      },
      tags: {
        source: QUESTIONS_FILE,
        number: '1',
        name: 'Poplatek za psa',
        trap: 'bez diakritiky.',
      },
    })
  })

  it('expects no documents when the archive holds no answer', () => {
    expect(recordOf({ ...question, documents: [] }).expectations).toEqual({
      expected_response: '200 Kč za každého psa za kalendářní rok.',
    })
  })
})

describe('staleRecords', () => {
  const fresh = [recordOf(question)]
  const stored = (id: string, change: object = {}) => ({ id, ...recordOf(question), ...change })

  it('keeps a record the file still holds', () => {
    expect(staleRecords([stored('a')], fresh)).toEqual([])
  })

  it('drops a record whose question was changed or removed', () => {
    expect(staleRecords([stored('a', { inputs: { question: 'kolik stoji pes' } })], fresh)).toEqual(
      ['a'],
    )
  })

  it('drops a record that lost an expectation, which an update would keep', () => {
    expect(staleRecords([stored('a')], [recordOf({ ...question, documents: [] })])).toEqual(['a'])
  })

  it('leaves a record added in the MLflow UI alone', () => {
    const added = { id: 'b', inputs: { question: 'jina' }, expectations: {}, tags: {} }
    expect(staleRecords([added], fresh)).toEqual([])
  })
})
