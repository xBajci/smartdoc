import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import type { ChatTraceStep } from '../../archive/types'
import { historyFromTraces, sessionHistory } from './history'
import { MAX_TURN_CHARACTERS } from './settings'

const answered = (number: number) => ({
  question: `Otázka ${number}`,
  answer: `Odpověď ${number}`,
  error: null,
})

describe('historyFromTraces', () => {
  it('turns every answered trace into a question and an answer, oldest first', () => {
    expect(historyFromTraces([answered(1), answered(2)], 12)).toEqual([
      { role: 'visitor', text: 'Otázka 1' },
      { role: 'archive', text: 'Odpověď 1' },
      { role: 'visitor', text: 'Otázka 2' },
      { role: 'archive', text: 'Odpověď 2' },
    ])
  })

  it('keeps only the last turns when the session is longer than the setting', () => {
    const history = historyFromTraces([answered(1), answered(2), answered(3), answered(4)], 4)
    expect(history.map((turn) => turn.text)).toEqual([
      'Otázka 3',
      'Odpověď 3',
      'Otázka 4',
      'Odpověď 4',
    ])
  })

  it('leaves out a question that failed or got no answer', () => {
    const traces = [
      answered(1),
      { question: 'selhani', answer: '', error: 'The model failed.' },
      { question: 'Bez odpovědi', answer: '', error: null },
      answered(2),
    ]
    expect(historyFromTraces(traces, 12).map((turn) => turn.text)).toEqual([
      'Otázka 1',
      'Odpověď 1',
      'Otázka 2',
      'Odpověď 2',
    ])
  })

  it('cuts an answer longer than a turn may be', () => {
    const long = { question: 'Otázka', answer: 'a'.repeat(MAX_TURN_CHARACTERS + 50), error: null }
    const [, answer] = historyFromTraces([long], 12)
    expect(answer?.text).toHaveLength(MAX_TURN_CHARACTERS)
  })

  it('is empty for the first question of a session', () => {
    expect(historyFromTraces([], 12)).toEqual([])
  })
})

const passage = (number: number) => ({
  number,
  chunkId: number,
  documentId: 'zapis',
  documentTitle: 'Zápis',
  page: 2,
  text: `Úryvek ${number}.`,
  wordRank: 1,
  meaningRank: 1,
  fusedScore: 1,
})
const searched = (...numbers: number[]): ChatTraceStep => ({
  kind: 'search',
  query: 'dotaz',
  durationMs: 0,
  embeddingTokens: 0,
  words: [],
  meaning: [],
  passages: numbers.map(passage),
})
const traced = (number: number, numbers: number[], messages: ModelMessage[] | null = null) => ({
  ...answered(number),
  steps: [searched(...numbers)],
  messages,
})

describe('sessionHistory', () => {
  it('sends the stored messages of every earlier question again, unchanged and oldest first', () => {
    const first: ModelMessage[] = [
      { role: 'user', content: 'Otázka 1' },
      { role: 'assistant', content: 'Odpověď 1 [1]' },
    ]
    const second: ModelMessage[] = [
      { role: 'user', content: 'Otázka 2' },
      { role: 'assistant', content: 'Odpověď 2 [3]' },
    ]
    const failed = { ...traced(3, [5], second), error: 'Selhalo.' }
    const history = sessionHistory(
      [traced(1, [1, 2], first), traced(2, [3, 4], second), failed],
      12,
    )
    expect(history.messages).toEqual([...first, ...second])
    expect(history.passages.map((item) => item.number)).toEqual([1, 2, 3, 4])
  })

  it('numbers the next passage after every passage of the session, a failed question too', () => {
    const failed = { ...traced(2, [7, 8]), error: 'Selhalo.' }
    expect(sessionHistory([traced(1, [1, 2]), failed], 12).firstNumber).toBe(9)
    expect(sessionHistory([], 12).firstNumber).toBe(1)
  })

  it('makes a question and its answer of a trace older than the messages', () => {
    expect(sessionHistory([traced(1, [1])], 12).messages).toEqual([
      { role: 'user', content: 'Otázka 1' },
      { role: 'assistant', content: 'Odpověď 1' },
    ])
  })

  it('tells the rewrite model the passages of each question as text, with the answer', () => {
    const [visitor, archive] = sessionHistory([traced(1, [1])], 12).forRewrite
    expect(visitor).toEqual({ role: 'visitor', text: 'Otázka 1' })
    expect(archive?.text).toBe(
      'Nalezené úryvky:\n[1] Dokument: Zápis, strana 2\nÚryvek 1.\n\nOdpověď: Odpověď 1',
    )
  })
})
