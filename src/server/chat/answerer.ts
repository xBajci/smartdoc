import { randomUUID } from 'node:crypto'
import { generateText, stepCountIs, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import type { ChatPassage, ChatTraceStep } from '../../archive/types'
import { FAKE_USAGE, spent } from '../ai/calls'
import { languageModel, modelName, modelSetting } from '../ai/models'
import {
  CALCULATION_TOOL,
  CALCULATIONS_USED_UP,
  NOTHING_FOUND,
  PARAMETERS_NOT_JSON,
  SEARCH_TOOL,
  SEARCHES_USED_UP,
  scriptFailed,
} from './instructions'
import { chatTelemetry } from './mlflow'
import { passagesForModel, type SearchStep } from './retrieval'
import { MAX_SCRIPT_CHARACTERS, parametersAsJson, runInSandbox, type ScriptRun } from './sandbox'
import type { ChatSettings } from './settings'

export interface AnswerInput {
  question: string
  /** The system prompt and the skills of the chat, put together. */
  instructions: string
  /** The earlier questions of the session as messages of the model (see `sessionHistory`). */
  history: readonly ModelMessage[]
  settings: ChatSettings
  /**
   * The first search, made before the model is called with the queries of the
   * rewrite; already in the trace. Empty when the conversation holds the answer.
   */
  found: readonly SearchStep[]
  /**
   * Runs one hybrid search. `last` says that no search may follow it: the
   * searches of the question are counted here and nowhere else.
   */
  search: (query: string, last: boolean) => Promise<SearchStep>
  /** Receives every model call and every search as it ends, so a failed run still leaves a trace. */
  trace: (step: ChatTraceStep) => void
}

export interface Answered {
  text: string
  /** The question, the first search and everything the model wrote; the next question sends them again. */
  messages: ModelMessage[]
}

/** Answers a question from the archive. The rest of the chat knows this function only, never a model. */
export type Answerer = (input: AnswerInput) => Promise<Answered>

const aiAnswerer: Answerer = async ({
  question,
  instructions,
  history,
  settings,
  found,
  search,
  trace,
}) => {
  const model = modelName('chat')
  /** Searches and calculations of the step that is running; they follow its model call in the trace. */
  let searched: SearchStep[] = []
  let calculated: CalculationStep[] = []
  /** Searches of the running step that came after the searches were used up. */
  let refused: string[] = []
  let stepStarted = Date.now()
  const searches = searchBudget(settings, found)
  const calculations = calculationBudget(settings)
  // Every step but the last uses up a search, a calculation or an errored run; a call
  // refused for a used-up limit wastes a step, and the margin leaves room for a few.
  const maxSteps =
    settings.maxSearches + settings.maxCalculations + settings.maxErroredRuns + 1 + REFUSAL_MARGIN

  try {
    const asked: ModelMessage = { role: 'user', content: question }
    const first = firstSearchMessages(found)
    const { text, responseMessages } = await generateText({
      model: languageModel('chat'),
      telemetry: chatTelemetry(),
      // Every step sends the instructions, the tools and the steps before it again. The provider
      // keeps that start in its cache and charges less for it: OpenAI by itself, where the key
      // sends the requests of the chat to the same cache, and Anthropic when asked to.
      providerOptions: {
        openai: { promptCacheKey: 'hm-archiv-chat' },
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
      instructions,
      messages: [...history, asked, ...first],
      tools: {
        [SEARCH_TOOL]: tool({
          description:
            'Prohledá dokumenty archivu obce a vrátí očíslované úryvky, které se k dotazu hodí nejvíc.',
          inputSchema: z.object({
            dotaz: z
              .string()
              .describe('Co hledat: klíčová slova nebo krátká věta v češtině, bez oslovení.'),
          }),
          execute: async ({ dotaz }) => {
            // The searches of one step all count as one, so a step that may search runs them all.
            if (!searches.allowed()) {
              refused.push(dotaz)
              return SEARCHES_USED_UP
            }
            const step = await search(dotaz, searches.last())
            searched.push(step)
            return searchResult(step)
          },
        }),
        [CALCULATION_TOOL]: calculationTool(calculations, (step) => calculated.push(step)),
      },
      stopWhen: stepCountIs(maxSteps),
      // The list of tools is part of the start of the prompt that the provider caches, and a
      // changed list makes the cache useless. So the list never changes: a tool whose limit is
      // used up says so when called, and only the tool choice changes.
      prepareStep: ({ stepNumber }) => {
        stepStarted = Date.now()
        const canSearch = searches.allowed()
        const canCalculate = calculations.allowed()
        // With nothing left to use, or in the last step, the model must answer from what it has.
        if ((!canSearch && !canCalculate) || stepNumber >= maxSteps - 1) {
          return { toolChoice: 'none' }
        }
        return {}
      },
      onStepEnd: (step) => {
        const tools = [...searched, ...calculated].reduce((sum, item) => sum + item.durationMs, 0)
        if (searched.length > 0) searches.stepSearched()
        trace({
          kind: 'model',
          step: step.stepNumber + 1,
          model,
          text: step.text,
          searches: searched.map((item) => item.query),
          ...(refused.length === 0 ? {} : { refusedSearches: refused }),
          calculations: calculated.length,
          durationMs: Math.max(0, Date.now() - stepStarted - tools),
          ...spent(model, step.usage),
        })
        for (const item of searched) trace(item)
        for (const item of calculated) trace(item)
        searched = []
        calculated = []
        refused = []
      },
    })
    // All steps: `response` holds only the last one.
    return { text, messages: [asked, ...first, ...responseMessages] }
  } finally {
    // Searches and calculations of a step that failed before it ended.
    for (const item of searched) trace(item)
    for (const item of calculated) trace(item)
  }
}

type CalculationStep = Extract<ChatTraceStep, { kind: 'calculation' }>

/** Steps the loop may spend on calls refused because their limit was used up. */
const REFUSAL_MARGIN = 2

/** What the model is told a search found. */
function searchResult(step: SearchStep): string {
  return step.passages.length === 0 ? NOTHING_FOUND : passagesForModel(step.passages)
}

/**
 * The first search as if the model had asked for it in one step: one call of
 * the search tool for each query, then what each found. So the model sees the
 * passages where it would see its own searches.
 */
function firstSearchMessages(found: readonly SearchStep[]): ModelMessage[] {
  if (found.length === 0) return []
  // The ids must differ from those of earlier questions, which the history sends again.
  const turn = randomUUID().slice(0, 8)
  const calls = found.map((step, index) => ({ id: `call_${turn}_${index + 1}`, step }))
  return [
    {
      role: 'assistant',
      content: calls.map(({ id, step }) => ({
        type: 'tool-call' as const,
        toolCallId: id,
        toolName: SEARCH_TOOL,
        input: { dotaz: step.query },
      })),
    },
    {
      role: 'tool',
      content: calls.map(({ id, step }) => ({
        type: 'tool-result' as const,
        toolCallId: id,
        toolName: SEARCH_TOOL,
        output: { type: 'text' as const, value: searchResult(step) },
      })),
    },
  ]
}

/**
 * Counts the searches of one question, by the steps that searched: a step may
 * send several searches at once, and they all count as one. The first search,
 * made before the model is called, counts as one too.
 */
export function searchBudget(
  settings: Pick<ChatSettings, 'maxSearches'>,
  found: readonly SearchStep[],
) {
  let steps = found.length === 0 ? 0 : 1
  return {
    allowed: () => steps < settings.maxSearches,
    /** Whether the step that is searching now is the last that may; the first search of a question is never called the last. */
    last: () => steps > 0 && steps + 1 >= settings.maxSearches,
    stepSearched: () => {
      steps += 1
    },
  }
}

/**
 * Counts the calculations of one question. Only a script that ran without an
 * error is a calculation; an errored run does not count, the model must fix the
 * script. So the model cannot fix scripts forever, errored runs have a limit of their own.
 */
export function calculationBudget(
  settings: Pick<ChatSettings, 'maxCalculations' | 'maxErroredRuns'>,
) {
  let done = 0
  let errored = 0
  /** Runs still going; each may end either way, so it holds a place in both limits. */
  let running = 0
  const allowed = () =>
    done + running < settings.maxCalculations && errored + running < settings.maxErroredRuns
  return {
    allowed,
    /** Takes a place for a run before anything waits, so runs asked for at once cannot all slip in. */
    reserve: () => {
      if (!allowed()) return false
      running += 1
      return true
    },
    settle: (run: ScriptRun) => {
      running -= 1
      if (run.error === null) done += 1
      else errored += 1
    },
  }
}

/** The tool the chat model calculates with; every run, refused ones too, goes to `record`. */
export function calculationTool(
  budget: ReturnType<typeof calculationBudget>,
  record: (step: CalculationStep) => void,
) {
  return tool({
    description:
      'Spustí krátký skript v JavaScriptu a vrátí jeho výsledek. Skript nemá přístup k síti ani k souborům. Slouží k výpočtům s čísly z úryvků archivu.',
    inputSchema: z.object({
      skript: z
        .string()
        .max(MAX_SCRIPT_CHARACTERS)
        .describe(
          'Tělo funkce v JavaScriptu. Data dostane v proměnné parametry, výsledek vrátí příkazem return.',
        ),
      parametry: z
        .record(z.string(), z.unknown())
        .describe('Čísla a údaje z úryvků, se kterými skript počítá, jako objekt JSON.'),
    }),
    execute: async ({ skript, parametry }) => {
      const { step, forModel } = await calculate(budget, skript, parametry)
      record(step)
      return forModel
    },
  })
}

/** Runs one script when the budget allows it; gives the trace step and what the model is told. */
async function calculate(
  budget: ReturnType<typeof calculationBudget>,
  script: string,
  parameters: Record<string, unknown>,
): Promise<{ step: CalculationStep; forModel: string }> {
  const started = Date.now()
  const allowed = budget.reserve()
  const json = parametersAsJson(parameters)
  let outcome: ScriptRun = { result: null, error: CALCULATIONS_USED_UP }
  if (allowed) {
    outcome =
      json === null
        ? { result: null, error: PARAMETERS_NOT_JSON }
        : await runInSandbox(script, json)
    budget.settle(outcome)
  }
  const step: CalculationStep = {
    kind: 'calculation',
    script,
    parameters: json ?? '',
    result: outcome.result,
    error: outcome.error,
    ran: allowed,
    durationMs: Date.now() - started,
  }
  if (outcome.result !== null) return { step, forModel: outcome.result }
  return { step, forModel: allowed ? scriptFailed(outcome.error) : CALCULATIONS_USED_UP }
}

/** Input tokens the fake model reports for a question with "dlouhy rozhovor", past the limit of the history. */
const FAKE_LONG_INPUT = 90_000
/** Input of every call after the first that the fake model reads from the cache, as a real provider would. */
const FAKE_CACHED_TOKENS = 800
const FAKE_QUOTE_CHARACTERS = 220
/** A question with this mark is answered slowly, so a test sees the progress of the search. */
const FAKE_SLOW = '(pomalu)'
const FAKE_READING_MS = 4000

/** Amounts in crowns as documents write them, like "870 000 Kč". */
const AMOUNT = /(\d{1,3}(?: \d{3})+|\d+) Kč/g
const SUM_SCRIPT = 'return parametry.castky.reduce((soucet, castka) => soucet + castka, 0)'

/**
 * A stand-in for the test suite (`AI_CHAT_MODEL=fake:chat`): it reads the first
 * search, and when that found no piece by its words, searches once more with
 * the previous question in front, the way a model widens a follow-up.
 * The answer quotes the best piece. A question with "selhani" fails on purpose.
 * A question with "celkem" adds up the amounts in crowns of the found pieces in
 * the sandbox; with "chybny skript" as well, the first script has a syntax error.
 * A question with "dlouhy rozhovor" reports a prompt past CHAT_HISTORY_TOKENS,
 * so the next question of the session is answered from a summary.
 * A question with "(pomalu)" reads every search a while, the first one too.
 */
const fakeAnswerer: Answerer = async ({
  question: asked,
  history,
  settings,
  found,
  search: find,
  trace,
}) => {
  const model = modelName('chat')
  const slow = asked.includes(FAKE_SLOW)
  const question = asked.replace(FAKE_SLOW, '').trim()
  const budget = searchBudget(settings, found)
  const search = async (query: string) => {
    const found = await find(query, budget.last())
    if (slow) await new Promise((resolve) => setTimeout(resolve, FAKE_READING_MS))
    return found
  }
  let step = 0
  const call = (text: string, searches: string[], calculations = 0) => {
    step += 1
    const cachedInputTokens = step === 1 ? 0 : FAKE_CACHED_TOKENS
    const inputTokens = question.includes('dlouhy rozhovor')
      ? FAKE_LONG_INPUT
      : FAKE_USAGE.inputTokens
    trace({
      kind: 'model',
      step,
      model,
      text,
      searches,
      calculations,
      durationMs: 1,
      ...spent(model, {
        inputTokens,
        outputTokens: FAKE_USAGE.outputTokens,
        inputTokenDetails: { cacheReadTokens: cachedInputTokens },
      }),
    })
  }
  const byWords = (passages: readonly ChatPassage[]) =>
    passages.filter((passage) => passage.wordRank !== null)

  if (question.includes('selhani')) throw new Error('The fake chat model was asked to fail.')

  if (slow && found.length > 0) await new Promise((resolve) => setTimeout(resolve, FAKE_READING_MS))
  let passages = found.flatMap((step) => step.passages)
  const done = (text: string): Answered => ({
    text,
    messages: [
      { role: 'user', content: asked },
      ...firstSearchMessages(found),
      { role: 'assistant', content: text },
    ],
  })
  const previous = history
    .flatMap((message) =>
      message.role === 'user' && typeof message.content === 'string' ? [message.content] : [],
    )
    .at(-1)
  if (byWords(passages).length === 0 && previous !== undefined) {
    const wider = `${previous} ${question}`
    call('', [wider])
    const widened = await search(wider)
    trace(widened)
    passages = widened.passages
  }

  if (question.includes('celkem')) {
    const counted = byWords(passages).flatMap((passage) => {
      const amounts = [...passage.text.matchAll(AMOUNT)].map((match) =>
        Number((match[1] ?? '').replaceAll(' ', '')),
      )
      return amounts.length === 0 ? [] : [{ number: passage.number, amounts }]
    })
    const parameters = { castky: counted.flatMap((passage) => passage.amounts) }
    const budget = calculationBudget(settings)
    const scripts = question.includes('chybny skript')
      ? [SUM_SCRIPT.slice(0, -1), SUM_SCRIPT]
      : [SUM_SCRIPT]
    let result: string | null = null
    for (const script of scripts) {
      call('', [], 1)
      const done = await calculate(budget, script, parameters)
      trace(done.step)
      result = done.step.result
    }
    const answer = `Celkem ${Number(result).toLocaleString('cs-CZ').replaceAll(/\s/g, ' ')} Kč ${counted.map((passage) => `[${passage.number}]`).join('')}`
    call(answer, [])
    return done(answer)
  }

  const best = byWords(passages)[0]
  const answer =
    best === undefined
      ? 'V archivu jsem k tomu nic nenašel. Zkuste otázku napsat jinak.'
      : `Podle dokumentu „${best.documentTitle}“: ${best.text.slice(0, FAKE_QUOTE_CHARACTERS)} [${best.number}]`
  call(answer, [])
  return done(answer)
}

export function getAnswerer(): Answerer {
  return modelSetting('chat').provider === 'fake' ? fakeAnswerer : aiAnswerer
}
