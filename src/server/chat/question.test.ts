import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelCall } from '../../ai/types'
import type { ChatProgress, ChatQuestion, ChatUpdate } from '../../chat/types'
import { defaultSkills } from '../ai/skills'
import { SUMMARY_LEAD } from './history'
import {
  answerQuestion,
  askArchive,
  askArchiveLive,
  type Asker,
  type QuestionWorld,
} from './question'
import type { KeptQuestion, QuestionStore } from './question-store'

// A question is asked here the way the application asks it, with the stand-in
// models of the test suite. Only what a question reaches outside itself for is
// replaced: the questions asked so far are kept in memory, and the search
// finds one fixed piece.

const VISITOR: Asker = { admin: false, hash: 'navstevnik-1' }
const ADMIN: Asker = { admin: true, hash: 'spravce' }

/** The questions asked so far, kept in memory, oldest first. */
function memoryStore() {
  const kept: { question: KeptQuestion; calls: ModelCall[]; at: Date }[] = []
  const store: QuestionStore = {
    askedSince: async (since, askerHash) =>
      kept.filter(
        ({ question, at }) =>
          at > since &&
          question.askerHash !== null &&
          (askerHash === undefined || question.askerHash === askerHash),
      ).length,
    earlier: async (conversationId) =>
      kept.flatMap(({ question }) =>
        question.conversationId === conversationId ? [question] : [],
      ),
    keep: async (question, calls) => {
      kept.push({ question, calls: [...calls], at: new Date() })
    },
  }
  return { kept, store }
}

let memory: ReturnType<typeof memoryStore>
/** The queries the search was asked for, in the order they came. */
let searched: string[]

/**
 * A search that finds one piece of the budget for every query. A query with
 * "jinak" finds it by meaning only, so the stand-in chat model searches again.
 * With a decision model it weighs the branches and reranks, as the real search does.
 */
const search: QuestionWorld['search'] = async (_question, query, _scope, tools) => {
  searched.push(query)
  const embedded = await tools.embed([query])
  const decided = tools.decider !== null
  if (decided) tools.onRerank?.()
  return {
    kind: 'search',
    query,
    durationMs: 5,
    embeddingTokens: embedded.tokens,
    words: [],
    meaning: [],
    passages: [
      {
        number: tools.numberOf(7),
        chunkId: 7,
        documentId: 'rozpocet-2025',
        documentTitle: 'Rozpočet 2025',
        page: 3,
        text: 'Na opravu chodníků jde 870 000 Kč.',
        wordRank: query.includes('jinak') ? null : 1,
        meaningRank: 1,
        fusedScore: 1,
      },
    ],
    ...(decided
      ? {
          weights: {
            model: 'fake:decision',
            exact: 0.2,
            both: 0.6,
            paraphrase: 0.2,
            words: 1,
            meaning: 1,
            durationMs: 1,
            inputTokens: 10,
            outputTokens: 0,
            costUsd: 0.00001,
            error: null,
          },
          rerank: {
            model: 'fake:decision',
            durationMs: 2,
            inputTokens: 20,
            outputTokens: 0,
            costUsd: 0.00002,
            candidates: [],
            error: null,
          },
        }
      : {}),
  }
}

const world = (): QuestionWorld => ({
  store: memory.store,
  skills: async () => defaultSkills(),
  search,
})

const question = (text: string, conversationId?: string): ChatQuestion => ({
  question: text,
  conversationId,
  scope: 'archive',
  documentIds: [],
})

const ask = (text: string, conversationId?: string, asker: Asker = VISITOR) =>
  askArchive(question(text, conversationId), asker, undefined, world())

/** Asks and gives the conversation back, for the questions that follow. */
async function asked(text: string, conversationId?: string): Promise<string> {
  const answer = await ask(text, conversationId)
  if (!answer.ok) throw new Error(`"${text}" got no answer: ${answer.problem}`)
  return answer.conversationId
}

const last = () => {
  const newest = memory.kept.at(-1)
  if (newest === undefined) throw new Error('No question was kept.')
  return newest
}
const kinds = () => last().question.steps.map((step) => step.kind)
const operations = () => last().calls.map((call) => call.operation)

describe('a question to the chat', () => {
  beforeEach(() => {
    memory = memoryStore()
    searched = []
    vi.stubEnv('AI_CHAT_MODEL', 'fake:chat')
    vi.stubEnv('AI_REWRITE_MODEL', 'fake:rewrite')
    vi.stubEnv('AI_SUMMARY_MODEL', 'fake:summary')
    vi.stubEnv('AI_EMBEDDING_MODEL', 'fake:embedding')
    vi.stubEnv('AI_DECISION_MODEL', 'fake:decision')
    vi.stubEnv(
      'AI_PRICES',
      '{"fake:chat":[1,2],"fake:rewrite":[1,2],"fake:summary":[1,2],"fake:embedding":[1,0],"fake:decision":[1,0]}',
    )
    vi.stubEnv('MLFLOW_TRACKING_URI', '')
    // The stand-in model that fails says so on the console, as a real failure would.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is answered from what the search found, with the sources the answer leans on', async () => {
    const answer = await ask('Kolik stojí oprava chodníků?')
    expect(answer).toEqual({
      ok: true,
      text: 'Podle dokumentu „Rozpočet 2025“: Na opravu chodníků jde 870 000 Kč. [1]',
      sources: [{ documentId: 'rozpocet-2025', page: 3 }],
      traceId: last().question.id,
      conversationId: last().question.conversationId,
    })
    // The small model writes the first search, the code runs it, the chat model answers.
    expect(searched).toEqual(['Kolik stojí oprava chodníků?'])
    expect(kinds()).toEqual(['rewrite', 'search', 'model'])
  })

  it('leaves a trace with every call it made and what they cost together', async () => {
    await ask('Kolik stojí oprava chodníků?')
    const { question: trace, calls } = last()
    expect(trace).toMatchObject({
      question: 'Kolik stojí oprava chodníků?',
      history: [],
      error: null,
      scope: 'archive',
      model: 'fake:chat',
      askerHash: 'navstevnik-1',
      mlflowTraceId: null,
    })
    expect(trace.messages?.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(trace.setup).toMatchObject({
      maxSearches: 3,
      historyPassages: 0,
      embeddingModel: 'fake:embedding',
      decisionModel: 'fake:decision',
      rewriteModel: 'fake:rewrite',
    })
    // One search is three calls: the embedding of the query, the weighing and the reranking.
    expect(operations()).toEqual(['rewrite', 'embed', 'weigh', 'rerank', 'chat'])
    // Each call names the place it was made at; a call told no skills names none.
    expect(calls.map((call) => call.use)).toEqual([
      'chat-rewrite',
      null,
      null,
      'chat-rerank',
      'chat-answer',
    ])
    expect(calls[0]?.skills).toContainEqual({ key: 'chat/preformulovani', version: 0 })
    expect(calls[1]?.skills).toBeNull()
    // 1000 tokens in and 100 out for each of the two models, and the three calls of the search.
    const search = calls.slice(1, 4).reduce((sum, call) => sum + (call.costUsd ?? 0), 0)
    expect(trace.costUsd).toBeCloseTo(0.0012 + 0.0012 + search, 9)
    expect(search).toBeGreaterThan(0.00003)
  })

  it('tells what it starts doing, in the order it does it', async () => {
    const progress: ChatProgress[] = []
    await askArchive(
      question('Kolik stojí oprava chodníků?'),
      VISITOR,
      (step) => progress.push(step),
      world(),
    )
    expect(progress).toEqual(['search', 'rank', 'read', 'check', 'sources'])
  })

  it('sends the progress first and the answer last', async () => {
    const updates: ChatUpdate[] = []
    for await (const update of askArchiveLive(
      question('Kolik stojí oprava chodníků?'),
      VISITOR,
      world(),
    )) {
      updates.push(update)
    }
    expect(updates.map((update) => update.kind)).toEqual([
      'progress',
      'progress',
      'progress',
      'progress',
      'progress',
      'answer',
    ])
  })

  it('starts a new conversation for a question without one, and for a conversation nobody knows', async () => {
    const first = await asked('Kolik stojí oprava chodníků?')
    const unknown = await asked('A kdy se opraví?', '11111111-2222-4333-8444-555555555555')
    expect(unknown).not.toBe('11111111-2222-4333-8444-555555555555')
    expect(unknown).not.toBe(first)
  })

  it('answers a follow-up with the conversation so far, and numbers its passages on', async () => {
    const conversationId = await asked('Kolik stojí oprava chodníků?')
    const answer = await ask('A kdy se opraví?', conversationId)
    expect(answer).toMatchObject({ ok: true, conversationId })
    const { question: trace } = last()
    expect(trace.history).toEqual([
      { role: 'visitor', text: 'Kolik stojí oprava chodníků?' },
      {
        role: 'archive',
        text: 'Podle dokumentu „Rozpočet 2025“: Na opravu chodníků jde 870 000 Kč. [1]',
      },
    ])
    expect(trace.setup.historyPassages).toBe(1)
    // The same piece found again gets the next number, so no two passages of a conversation share one.
    const found = trace.steps.flatMap((step) => (step.kind === 'search' ? step.passages : []))
    expect(found.map((passage) => passage.number)).toEqual([2])
    // The visitor's sources are numbered from one in every answer.
    expect(answer).toMatchObject({ text: expect.stringMatching(/\[1\]$/) })
  })

  it('says of a search whether another may follow it', async () => {
    vi.stubEnv('CHAT_MAX_SEARCHES', '2')
    const conversationId = await asked('Kolik stojí oprava chodníků?')
    const progress: ChatProgress[] = []
    // Found by meaning only, so the stand-in model searches once more, and that search is its last.
    await askArchive(
      question('A jinak?', conversationId),
      VISITOR,
      (step) => progress.push(step),
      world(),
    )
    expect(searched.slice(1)).toEqual(['A jinak?', 'Kolik stojí oprava chodníků? A jinak?'])
    expect(progress).toEqual(['search', 'rank', 'read', 'lastSearch', 'rank', 'read', 'check'])
    expect(kinds()).toEqual(['rewrite', 'search', 'model', 'search', 'model'])
  })

  it('sums up a conversation that grew too long, and answers from the summary', async () => {
    // The stand-in model reports a prompt past CHAT_HISTORY_TOKENS for this question.
    const conversationId = await asked('dlouhy rozhovor o chodnících')
    await ask('A kdy se opraví?', conversationId)
    const { question: trace } = last()
    expect(kinds()).toEqual(['summary', 'rewrite', 'search', 'model'])
    expect(operations()[0]).toBe('summary-chat')
    expect(last().calls[0]).toMatchObject({ use: 'chat-summary', input: 'Otázek: 1' })
    // The summary stands for the questions so far; their passages can no longer be cited.
    expect(trace.history).toEqual([
      {
        role: 'visitor',
        text: `${SUMMARY_LEAD}\nNávštěvník se ptal: dlouhy rozhovor o chodnících`,
      },
    ])
    expect(trace.setup.historyPassages).toBe(0)
    // The numbers go on all the same.
    const found = trace.steps.flatMap((step) => (step.kind === 'search' ? step.passages : []))
    expect(found.map((passage) => passage.number)).toEqual([2])
  })

  it('keeps the trace and the cost of a question that got no answer', async () => {
    const answer = await ask('selhani modelu')
    expect(answer).toEqual({ ok: false, problem: 'failed' })
    const { question: trace } = last()
    expect(trace).toMatchObject({
      answer: '',
      error: 'The fake chat model was asked to fail.',
      messages: null,
    })
    // What happened before the failure was paid for too.
    expect(kinds()).toEqual(['rewrite', 'search'])
    expect(operations()).toEqual(['rewrite', 'embed', 'weigh', 'rerank'])
    expect(trace.costUsd).toBeGreaterThan(0.0012)
  })

  it('leaves a failed question out of what the next one is told', async () => {
    const conversationId = await asked('Kolik stojí oprava chodníků?')
    await ask('selhani modelu', conversationId)
    await ask('A kdy se opraví?', conversationId)
    expect(last().question.history.map((turn) => turn.text)).toEqual([
      'Kolik stojí oprava chodníků?',
      'Podle dokumentu „Rozpočet 2025“: Na opravu chodníků jde 870 000 Kč. [1]',
    ])
  })

  it('stops a visitor at the hourly limit, and all visitors at the daily one', async () => {
    vi.stubEnv('CHAT_HOURLY_LIMIT', '2')
    vi.stubEnv('CHAT_DAILY_LIMIT', '3')
    await ask('První otázka?')
    await ask('Druhá otázka?')
    expect(await ask('Třetí otázka?')).toEqual({ ok: false, problem: 'hourly-limit' })
    const other: Asker = { admin: false, hash: 'navstevnik-2' }
    expect(await ask('Otázka jiného návštěvníka?', undefined, other)).toMatchObject({ ok: true })
    expect(await ask('Další otázka?', undefined, other)).toEqual({
      ok: false,
      problem: 'daily-limit',
    })
    expect(memory.kept).toHaveLength(3)
  })

  it('has no limit for the administrator, whose questions count for nobody', async () => {
    vi.stubEnv('CHAT_HOURLY_LIMIT', '1')
    vi.stubEnv('CHAT_DAILY_LIMIT', '1')
    expect(await ask('První otázka?', undefined, ADMIN)).toMatchObject({ ok: true })
    expect(await ask('Druhá otázka?', undefined, ADMIN)).toMatchObject({ ok: true })
    expect(last().question.askerHash).toBeNull()
    expect(await ask('Otázka návštěvníka?')).toMatchObject({ ok: true })
  })

  it('answers nothing when the chat model has no key', async () => {
    vi.stubEnv('AI_CHAT_MODEL', 'openai:gpt-test')
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await ask('Kolik stojí oprava chodníků?')).toEqual({ ok: false, problem: 'not-set-up' })
    expect(memory.kept).toHaveLength(0)
    expect(searched).toEqual([])
  })
})

describe('a test question', () => {
  beforeEach(() => {
    memory = memoryStore()
    searched = []
    vi.stubEnv('AI_CHAT_MODEL', 'fake:chat')
    vi.stubEnv('AI_REWRITE_MODEL', 'fake:rewrite')
    vi.stubEnv('AI_SUMMARY_MODEL', 'fake:summary')
    vi.stubEnv('AI_EMBEDDING_MODEL', 'fake:embedding')
    vi.stubEnv('AI_DECISION_MODEL', 'fake:decision')
    vi.stubEnv('AI_PRICES', '{"fake:chat":[1,2],"fake:rewrite":[1,2],"fake:embedding":[1,0]}')
    vi.stubEnv('MLFLOW_TRACKING_URI', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is answered the way the chat answers, and nothing is kept of it', async () => {
    // Visitors have used up the day; a test question is not one of theirs.
    vi.stubEnv('CHAT_DAILY_LIMIT', '1')
    await ask('Otázka návštěvníka?')
    expect(await ask('Další otázka návštěvníka?')).toEqual({ ok: false, problem: 'daily-limit' })

    const first = await answerQuestion('Kolik stojí oprava chodníků?', {}, world())
    expect(first).toMatchObject({
      answer: 'Podle dokumentu „Rozpočet 2025“: Na opravu chodníků jde 870 000 Kč. [1]',
      sources: [{ documentId: 'rozpocet-2025', page: 3 }],
      error: null,
      mlflowTraceId: null,
    })
    expect(first.steps.map((step) => step.kind)).toEqual(['rewrite', 'search', 'model'])
    // Only the visitor's one question is there.
    expect(memory.kept).toHaveLength(1)
  })

  it('can leave the decision model out, so only the two branches are measured', async () => {
    const answered = await answerQuestion(
      'Kolik stojí oprava chodníků?',
      { decisions: false },
      world(),
    )
    const found = answered.steps.find((step) => step.kind === 'search')
    expect(found).toMatchObject({ query: 'Kolik stojí oprava chodníků?' })
    expect(found).not.toHaveProperty('weights')
    expect(found).not.toHaveProperty('rerank')
    // The rewrite, the chat model and the embedding of the one query.
    expect(answered.costUsd).toBeCloseTo(0.0012 + 0.0012 + 0.000007, 9)
  })
})
