import { describe, expect, it } from 'vitest'
import { historyFromTraces } from './history'
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
