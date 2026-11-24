import { randomUUID } from 'node:crypto'
import type { ModelMessage } from 'ai'
import type { ModelCall } from '../../ai/types'
import type {
  ChatAnswer,
  ChatPassage,
  ChatProgress,
  ChatQuestion,
  ChatSource,
  ChatTraceStep,
  ChatUpdate,
} from '../../chat/types'
import { costOfCalls, reasonOf } from '../ai/calls'
import { missingKey, modelName } from '../ai/models'
import { instructionsFor, type LoadedSkill, type SkillUse } from '../ai/skills'
import { loadSkills } from '../skills-service'
import { getAnswerer } from './answerer'
import { resolveCitations } from './citations'
import { getDecider } from './decisions'
import { getEmbedder } from './embedder'
import { NO_HISTORY, conversationHistory, summarized, type ConversationHistory } from './history'
import { chatFixed, rewriteFixed } from './instructions'
import { traceQuestion, traceSearch } from './mlflow'
import { callsOfSteps, type Told } from './question-calls'
import { postgresStore, type QuestionStore } from './question-store'
import { hybridSearch, type SearchScope, type SearchStep } from './retrieval'
import { getRewriter } from './rewriter'
import { chatSettings } from './settings'
import { getSummarizer } from './summarizer'

/**
 * One question to the chat, from the question to the answer and its record.
 * This is the one place that knows the order of a question: the limits, the
 * conversation it joins, the summary of a long conversation, the first search, the
 * chat model with its searches and calculations, the citations, and what is
 * kept of it all. The visitor's chat and the test questions both ask here.
 */

const HOUR_MS = 3_600_000

export interface Asker {
  /** The administrator tries questions in the debugger and has no limit. */
  admin: boolean
  /** Stands for the visitor's address; see `clientKey`. */
  hash: string
}

/**
 * What answering a question reaches outside itself for. The application gives
 * the archive in Postgres; the tests of a question give their own.
 */
export interface QuestionWorld {
  store: QuestionStore
  /** The skills in force now (see `loadSkills`). */
  skills: () => Promise<LoadedSkill[]>
  search: typeof hybridSearch
}

/** What the application answers from: the questions and the documents in Postgres. */
const ARCHIVE: QuestionWorld = {
  store: postgresStore,
  skills: () => loadSkills(),
  search: hybridSearch,
}

async function overLimit(
  asker: Asker,
  store: QuestionStore,
): Promise<'hourly-limit' | 'daily-limit' | null> {
  if (asker.admin) return null
  const { hourlyLimit, dailyLimit } = chatSettings()
  const since = (ms: number) => new Date(Date.now() - ms)
  const [hour, day] = await Promise.all([
    store.askedSince(since(HOUR_MS), asker.hash),
    store.askedSince(since(24 * HOUR_MS)),
  ])
  if (hour >= hourlyLimit) return 'hourly-limit'
  if (day >= dailyLimit) return 'daily-limit'
  return null
}

/**
 * The conversation a question joins and what the model is told of it. A question
 * without a conversation, or with one no trace knows, starts a new conversation under a
 * fresh id: the client never gets to choose an id of its own.
 */
async function joinConversation(
  conversationId: string | undefined,
  store: QuestionStore,
): Promise<{ conversationId: string; history: ConversationHistory }> {
  if (conversationId === undefined) return { conversationId: randomUUID(), history: NO_HISTORY }
  const earlier = await store.earlier(conversationId)
  if (earlier.length === 0) return { conversationId: randomUUID(), history: NO_HISTORY }
  return { conversationId, history: conversationHistory(earlier) }
}

/** One question as it is asked here, whoever asks it. */
interface Asked {
  /** The id of the question, as `chat_traces` and MLflow know it. */
  id: string
  conversationId: string
  question: string
  scope: SearchScope
  /** What the models are told of the conversation so far. */
  history: ConversationHistory
  /** `false` leaves the decision model out: both branches weigh the same and nothing is reranked. */
  decisions: boolean
  /** More tags for the trace in MLflow. */
  tags?: Record<string, string> | undefined
  /** Hears what the chat starts doing, so the visitor can be told while they wait. */
  report?: ((progress: ChatProgress) => void) | undefined
}

/** Everything one question came to. */
interface Outcome {
  /** The answer with the visitor's marks of its sources; empty when none was made. */
  answer: string
  sources: ChatSource[]
  /** Why no answer was made; the steps until then are kept. */
  error: string | null
  steps: ChatTraceStep[]
  /** Every call to a model the question made, as the records of AI calls keep them. */
  calls: ModelCall[]
  /** Over all calls; `null` when no call had a known price. */
  costUsd: number | null
  mlflowTraceId: string | null
  /** The history the question was answered with: the one asked with, or its summary. */
  history: ConversationHistory
  /** What the next question of the conversation sends again; `null` when no answer was made. */
  messages: ModelMessage[] | null
  /** The instructions and the numbers that were in force. */
  setup: Record<string, string | number>
}

/**
 * Answers one question, in the order the chat works in, as one trace in
 * MLflow. It reads the archive and calls models, and writes nothing.
 */
async function answer(asked: Asked, world: QuestionWorld): Promise<Outcome> {
  const { question, scope } = asked
  const settings = chatSettings()
  let history = asked.history
  // The same step told twice in a row is told once: the queries of the first search run together.
  let heard: ChatProgress | null = null
  const report = (progress: ChatProgress) => {
    if (progress === heard) return
    heard = progress
    asked.report?.(progress)
  }
  const steps: ChatTraceStep[] = []
  const embed = getEmbedder()
  const decider = asked.decisions ? getDecider() : null
  // What the models of this question are told: the system prompt and the skills of the chat.
  const skills = await world.skills()
  const told = (use: SkillUse, fixed?: readonly string[]): Told => ({
    use,
    ...instructionsFor(skills, use, fixed),
  })
  const places = {
    summary: told('chat-summary'),
    rewrite: told('chat-rewrite', rewriteFixed()),
    answer: told('chat-answer', chatFixed()),
    rerank: told('chat-rerank'),
  }
  let embeddingModel = modelName('embedding')

  /** Numbers of pieces, shared by all searches of the question; they go on from the earlier questions. */
  const numbers = new Map<number, number>()
  const numberOf = (chunkId: number) => {
    const known = numbers.get(chunkId)
    if (known !== undefined) return known
    const number = history.firstNumber + numbers.size
    numbers.set(chunkId, number)
    return number
  }

  const search = async (query: string): Promise<SearchStep> => {
    const found = await traceSearch(query, () =>
      world.search(question, query, scope, {
        embed: async (texts) => {
          const embedded = await embed(texts)
          embeddingModel = embedded.model
          return embedded
        },
        decider,
        rerankGuidance: places.rerank.text,
        settings,
        numberOf,
        onRerank: () => report('rank'),
      }),
    )
    // The pieces go to the model next, which reads them.
    report('read')
    return found
  }

  let text = ''
  let messages: ModelMessage[] | null = null
  let error: string | null = null
  let mlflowTraceId: string | null = null
  const summarizer = getSummarizer()
  const rewriter = getRewriter()
  const answerer = getAnswerer()
  try {
    const answered = await traceQuestion(
      { question, questionId: asked.id, conversationId: asked.conversationId, tags: asked.tags },
      async () => {
        // The history only grows, so its start stays in the provider's cache. Once the prompt
        // has grown past the limit, a summary stands for the questions so far.
        if (history.promptTokens > settings.historyTokens) {
          const summary = await summarizer({
            turns: history.forRewrite,
            questions: history.questions,
            instructions: places.summary.text,
          })
          steps.push(summary)
          if (summary.error === null) history = summarized(history, summary.text)
        }
        // A small model writes the queries of the first search, and the code runs them;
        // the chat model starts with their passages and searches more only when it needs to.
        const rewrite = await rewriter({
          question,
          history: history.forRewrite,
          instructions: places.rewrite.text,
        })
        steps.push(rewrite)
        if (rewrite.queries.length > 0) report('search')
        const found = await Promise.all(rewrite.queries.map(search))
        steps.push(...found)
        return answerer({
          question,
          instructions: places.answer.text,
          history: history.messages,
          settings,
          found,
          trace: (step) => steps.push(step),
          search: (query, last) => {
            report(last ? 'lastSearch' : 'search')
            return search(query)
          },
        })
      },
      (traceId) => (mlflowTraceId = traceId),
    )
    text = answered.text
    messages = answered.messages
  } catch (caught) {
    console.error(`Chat question ${asked.id} failed:`, caught)
    error = reasonOf(caught)
  }

  const passages = steps.flatMap((step): ChatPassage[] =>
    step.kind === 'search' ? step.passages : [],
  )
  if (error === null && text !== '') report('check')
  // The answer may cite a passage an earlier question found; the history gave the model those too.
  const resolved = resolveCitations(text, [...history.passages, ...passages])
  if (resolved.sources.length > 0) report('sources')

  const calls = callsOfSteps(steps, { question, embeddingModel, ...places })
  return {
    answer: resolved.text,
    sources: resolved.sources,
    error,
    steps,
    calls,
    costUsd: costOfCalls(calls),
    mlflowTraceId,
    history,
    messages: error === null ? messages : null,
    setup: {
      ...settings,
      historyPassages: history.passages.length,
      embeddingModel,
      decisionModel: decider === null ? 'off' : modelName('decision'),
      summaryModel: modelName('summary'),
      rewriteModel: modelName('rewrite'),
      rewriteInstructions: places.rewrite.text,
      instructions: places.answer.text,
    },
  }
}

/**
 * Answers one question of a visitor and leaves a trace of how the answer came
 * to be. The trace and the cost are written whether the answer was made or not.
 */
export async function askArchive(
  input: ChatQuestion,
  asker: Asker,
  report?: (progress: ChatProgress) => void,
  world: QuestionWorld = ARCHIVE,
): Promise<ChatAnswer> {
  const limit = await overLimit(asker, world.store)
  if (limit !== null) return { ok: false, problem: limit }
  if ((missingKey('chat') ?? missingKey('embedding')) !== null) {
    return { ok: false, problem: 'not-set-up' }
  }

  const id = randomUUID()
  const started = Date.now()
  const { conversationId, history } = await joinConversation(input.conversationId, world.store)
  const outcome = await answer(
    {
      id,
      conversationId,
      question: input.question,
      scope: input,
      history,
      decisions: true,
      report,
    },
    world,
  )
  await world.store.keep(
    {
      id,
      conversationId,
      question: input.question,
      history: outcome.history.turns,
      answer: outcome.answer,
      error: outcome.error,
      scope: input.scope,
      model: modelName('chat'),
      steps: outcome.steps,
      messages: outcome.messages,
      setup: outcome.setup,
      durationMs: Date.now() - started,
      costUsd: outcome.costUsd,
      askerHash: asker.admin ? null : asker.hash,
      mlflowTraceId: outcome.mlflowTraceId,
    },
    outcome.calls,
  )

  if (outcome.error !== null || outcome.answer === '') return { ok: false, problem: 'failed' }
  return { ok: true, text: outcome.answer, sources: outcome.sources, traceId: id, conversationId }
}

/**
 * Answers one question like `askArchive`, but yields what the chat starts
 * doing while it works, so the visitor sees the progress. The answer comes last.
 */
export async function* askArchiveLive(
  input: ChatQuestion,
  asker: Asker,
  world: QuestionWorld = ARCHIVE,
): AsyncGenerator<ChatUpdate> {
  const waiting: ChatUpdate[] = []
  let done = false
  let wake: (() => void) | undefined
  const push = (update: ChatUpdate) => {
    waiting.push(update)
    wake?.()
  }
  const work = askArchive(input, asker, (progress) => push({ kind: 'progress', progress }), world)
    .then((answered) => push({ kind: 'answer', answer: answered }))
    .finally(() => {
      done = true
      wake?.()
    })
  // A failure is thrown below, after the progress before it was sent.
  work.catch(() => undefined)
  for (;;) {
    const next = waiting.shift()
    if (next !== undefined) {
      yield next
    } else if (done) {
      break
    } else {
      await new Promise<void>((resolve) => (wake = resolve))
      wake = undefined
    }
  }
  await work
}

/** How a test question differs from a visitor's. */
export interface TrialOptions {
  /** `false` leaves the decision model out, so only the search of the two branches is measured. */
  decisions?: boolean
  /** More tags for the trace in MLflow, such as the number of a test question. */
  tags?: Record<string, string>
}

/** What a test question came to; nothing of it is kept. */
export type TrialAnswer = Pick<
  Outcome,
  'answer' | 'sources' | 'error' | 'steps' | 'costUsd' | 'mlflowTraceId'
>

/**
 * Answers one question over the whole archive the way the chat does, with its
 * settings, its skills and its searches, as the first question of a conversation.
 * It has no limit and writes nothing to the database, so the test questions
 * use it (`pnpm eval:run`, `pnpm search:eval --model`).
 */
export async function answerQuestion(
  question: string,
  options: TrialOptions = {},
  world: QuestionWorld = ARCHIVE,
): Promise<TrialAnswer> {
  const {
    answer: text,
    sources,
    error,
    steps,
    costUsd,
    mlflowTraceId,
  } = await answer(
    {
      id: randomUUID(),
      conversationId: randomUUID(),
      question,
      scope: { scope: 'archive', documentIds: [] },
      history: NO_HISTORY,
      decisions: options.decisions ?? true,
      tags: options.tags,
    },
    world,
  )
  return { answer: text, sources, error, steps, costUsd, mlflowTraceId }
}
