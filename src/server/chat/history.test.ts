import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import type { ChatTraceStep } from '../../chat/types'
import { historyFromTraces, conversationHistory, summarized, SUMMARY_LEAD } from './history'
import { MAX_TURN_CHARACTERS } from './settings'

const answered = (number: number) => ({
  question: `Otázka ${number}`,
  answer: `Odpověď ${number}`,
  error: null,
})

describe('historyFromTraces', () => {
  it('turns every answered trace into a question and an answer, oldest first', () => {
    expect(historyFromTraces([answered(1), answered(2)])).toEqual([
      { role: 'visitor', text: 'Otázka 1' },
      { role: 'archive', text: 'Odpověď 1' },
      { role: 'visitor', text: 'Otázka 2' },
      { role: 'archive', text: 'Odpověď 2' },
    ])
  })

  it('leaves out a question that failed or got no answer', () => {
    const traces = [
      answered(1),
      { question: 'selhani', answer: '', error: 'The model failed.' },
      { question: 'Bez odpovědi', answer: '', error: null },
      answered(2),
    ]
    expect(historyFromTraces(traces).map((turn) => turn.text)).toEqual([
      'Otázka 1',
      'Odpověď 1',
      'Otázka 2',
      'Odpověď 2',
    ])
  })

  it('cuts an answer longer than a turn may be', () => {
    const long = { question: 'Otázka', answer: 'a'.repeat(MAX_TURN_CHARACTERS + 50), error: null }
    const [, answer] = historyFromTraces([long])
    expect(answer?.text).toHaveLength(MAX_TURN_CHARACTERS)
  })

  it('is empty for the first question of a conversation', () => {
    expect(historyFromTraces([])).toEqual([])
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

describe('conversationHistory', () => {
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
    const history = conversationHistory([
      traced(1, [1, 2], first),
      traced(2, [3, 4], second),
      failed,
    ])
    expect(history.messages).toEqual([...first, ...second])
    expect(history.passages.map((item) => item.number)).toEqual([1, 2, 3, 4])
  })

  it('numbers the next passage after every passage of the conversation, a failed question too', () => {
    const failed = { ...traced(2, [7, 8]), error: 'Selhalo.' }
    expect(conversationHistory([traced(1, [1, 2]), failed]).firstNumber).toBe(9)
    expect(conversationHistory([]).firstNumber).toBe(1)
  })

  it('makes a question and its answer of a trace older than the messages', () => {
    expect(conversationHistory([traced(1, [1])]).messages).toEqual([
      { role: 'user', content: 'Otázka 1' },
      { role: 'assistant', content: 'Odpověď 1' },
    ])
  })

  it('tells the rewrite model the passages of each question as text, with the answer', () => {
    const [visitor, archive] = conversationHistory([traced(1, [1])]).forRewrite
    expect(visitor).toEqual({ role: 'visitor', text: 'Otázka 1' })
    expect(archive?.text).toBe(
      'Nalezené úryvky:\n[1] Dokument: Zápis, strana 2\nÚryvek 1.\n\nOdpověď: Odpověď 1',
    )
  })
})

const summedUp = (text: string, questions: number): ChatTraceStep => ({
  kind: 'summary',
  model: 'fake:summary',
  text,
  questions,
  error: null,
  durationMs: 1,
  inputTokens: 1000,
  outputTokens: 100,
  costUsd: null,
})
const modelCall = (inputTokens: number): ChatTraceStep => ({
  kind: 'model',
  step: 1,
  model: 'fake:chat',
  text: '',
  searches: [],
  durationMs: 1,
  inputTokens,
  outputTokens: 10,
  costUsd: null,
})

describe('a summary in the history', () => {
  it('stands for every question before the one that made it', () => {
    const third: ModelMessage[] = [
      { role: 'user', content: 'Otázka 3' },
      { role: 'assistant', content: 'Odpověď 3' },
    ]
    const withSummary = {
      ...traced(3, [5, 6], third),
      steps: [summedUp('Ptal se na 1 a 2.', 2), searched(5, 6)],
    }
    const history = conversationHistory([traced(1, [1, 2]), traced(2, [3, 4]), withSummary])
    expect(history.messages).toEqual([
      { role: 'user', content: `${SUMMARY_LEAD}\nPtal se na 1 a 2.` },
      ...third,
    ])
    expect(history.passages.map((item) => item.number)).toEqual([5, 6])
    expect(history.firstNumber).toBe(7)
    expect(history.questions).toBe(3)
    expect(history.forRewrite[0]?.text).toBe(`${SUMMARY_LEAD}\nPtal se na 1 a 2.`)
  })

  it('is left out when it failed, and the whole history is sent', () => {
    const failed = { ...summedUp('', 1), error: 'Selhalo.' }
    const second = { ...traced(2, [3]), steps: [failed, searched(3)] }
    expect(conversationHistory([traced(1, [1]), second]).questions).toBe(2)
  })

  it('knows how far the prompt grew from the last model call of the last answered question', () => {
    const last = { ...traced(2, [2]), steps: [modelCall(5000), searched(2), modelCall(9000)] }
    expect(conversationHistory([traced(1, [1]), last]).promptTokens).toBe(9000)
    expect(conversationHistory([]).promptTokens).toBe(0)
  })

  it('once made, leaves no passage to cite and goes on with the numbers', () => {
    const history = summarized(conversationHistory([traced(1, [1, 2]), traced(2, [3])]), 'Shrnutí.')
    expect(history).toMatchObject({ passages: [], firstNumber: 4, questions: 2, promptTokens: 0 })
    expect(history.messages).toEqual([{ role: 'user', content: `${SUMMARY_LEAD}\nShrnutí.` }])
  })
})
