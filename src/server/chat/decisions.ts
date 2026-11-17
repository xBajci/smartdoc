import { searchWords } from '../../archive/query'
import { askJev } from '../ai/jev'
import { missingKey, modelSetting } from '../ai/models'

/** What every small decision of the chat costs. */
interface Decided {
  inputTokens: number
  outputTokens: number
  /** As written in `.env`: provider:model. */
  model: string
}

export interface Weighed extends Decided {
  /** What kind of query it is: probabilities of exact words, of both, of own words; they add up to one. */
  exact: number
  both: number
  paraphrase: number
}

/** A piece as the reranker reads it. */
export interface RerankCandidate {
  title: string
  text: string
}

export interface Reranked extends Decided {
  /** One number from 0 to 1 per candidate, in the order of the candidates: how well it answers. */
  scores: number[]
}

/**
 * The two small decisions of one search. They are two calls on purpose: the
 * weights must be known before the branches are joined, and the reranker can
 * only score what the joining chose. `question` is what the visitor wrote,
 * `query` what the chat model searched for; a follow-up question alone may
 * not say what it is about.
 */
export interface Decider {
  /** Says whether the query asks for exact words (BM25 is better) or for a meaning (embeddings are). */
  weigh: (question: string, query: string) => Promise<Weighed>
  /** Says for every piece how likely it helps to answer the question. */
  rerank: (
    question: string,
    query: string,
    candidates: readonly RerankCandidate[],
    /** The skills for judging a passage, as one text; may be empty. */
    guidance: string,
  ) => Promise<Reranked>
}

/** Jev answers typed questions with probabilities; one call carries one decision. */
const jevDecider: Decider = {
  async weigh(question, query) {
    const { answers, ...usage } = await askJev(
      { otazka: question, hledany_dotaz: query },
      {
        druh: {
          type: 'choice',
          instructions:
            'A search over municipal documents runs `hledany_dotaz` to answer `otazka`. What kind of search is it?',
          criteria: {
            PRESNE:
              'It looks for exact words: a name of a person, company or street, a number, a date, a document number, or a quoted phrase.',
            VYZNAM:
              'It describes a topic in its own words; the documents may say the same thing with other words.',
            OBOJI: 'It has both an exact word to match and a topic described in own words.',
          },
        },
      },
    )
    const kind = answers.druh?.probabilities
    if (kind === undefined) throw new Error('Jev gave no answer about the kind of query.')
    return {
      exact: kind.PRESNE ?? 0,
      both: kind.OBOJI ?? 0,
      paraphrase: kind.VYZNAM ?? 0,
      ...usage,
    }
  },

  async rerank(question, query, candidates, guidance) {
    const state: Record<string, string> = { otazka: question, hledany_dotaz: query }
    const questions: Parameters<typeof askJev>[1] = {}
    candidates.forEach((candidate, index) => {
      const name = `uryvek_${index + 1}`
      state[name] = `Dokument: ${candidate.title}\n${candidate.text}`
      questions[name] = {
        type: 'noul',
        instructions:
          `Does \`${name}\` contain information that helps to answer \`otazka\` (searched for as \`hledany_dotaz\`)? A text that is only on the same topic does not count.` +
          (guidance === '' ? '' : `\n\nRules of the archive (in Czech):\n${guidance}`),
      }
    })
    const { answers, ...usage } = await askJev(state, questions)
    const scores = candidates.map((_, index) => {
      const score = answers[`uryvek_${index + 1}`]?.noul
      if (typeof score !== 'number') throw new Error(`Jev gave no answer for piece ${index + 1}.`)
      return score
    })
    return { scores, ...usage }
  },
}

const FAKE_MODEL = 'fake:decision'
/** Words are compared by their first letters, the way the fake embedder does. */
const FAKE_STEM_LETTERS = 5
const fakeTokens = (texts: readonly string[]) =>
  texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0)

/**
 * A stand-in for the test suite (`AI_DECISION_MODEL=fake:decision`): a query
 * with a digit asks for exact words, and a piece scores by the share of the
 * words of the query that it has.
 */
export const fakeDecider: Decider = {
  weigh: (question, query) =>
    Promise.resolve({
      model: FAKE_MODEL,
      inputTokens: fakeTokens([question, query]),
      outputTokens: 0,
      ...(/\d/.test(query)
        ? { exact: 0.8, both: 0.2, paraphrase: 0 }
        : { exact: 0.2, both: 0.6, paraphrase: 0.2 }),
    }),

  rerank: (_question, query, candidates) => {
    const stems = (text: string) =>
      new Set(searchWords(text, Infinity).map((word) => word.slice(0, FAKE_STEM_LETTERS)))
    const wanted = [...stems(query)]
    return Promise.resolve({
      model: FAKE_MODEL,
      inputTokens: fakeTokens(candidates.map((candidate) => candidate.text)),
      outputTokens: 0,
      scores: candidates.map((candidate) => {
        const has = stems(`${candidate.title} ${candidate.text}`)
        return wanted.length === 0
          ? 0
          : wanted.filter((stem) => has.has(stem)).length / wanted.length
      }),
    })
  },
}

/** The decision model, or `null` when it is switched off (`AI_DECISION_MODEL=off`) or has no key. */
export function getDecider(): Decider | null {
  if (process.env.AI_DECISION_MODEL === 'off') return null
  const { provider } = modelSetting('decision')
  if (provider === 'fake') return fakeDecider
  if (provider !== 'typesafe') {
    throw new Error(
      `The provider "${provider}" makes no decisions here. Use typesafe:<model> or off.`,
    )
  }
  return missingKey('decision') === null ? jevDecider : null
}

/**
 * Weights of the two branches from the kind of the query. Both are 1 for a
 * query that is surely of both kinds; `spread` is how far a weight moves when
 * the query is surely of one kind. The two weights always add up to 2.
 */
export function branchWeights(
  kind: { exact: number; paraphrase: number },
  spread: number,
): { words: number; meaning: number } {
  const shift = Math.min(1, Math.max(-1, kind.exact - kind.paraphrase)) * Math.min(spread, 1)
  return { words: 1 + shift, meaning: 1 - shift }
}

/**
 * The order after reranking: the highest score first, and the order of the
 * fusion decides between equal scores. Returns indexes into `scores`.
 */
export function orderByScore(scores: readonly number[], limit: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.index)
}
