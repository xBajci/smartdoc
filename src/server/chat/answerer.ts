import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import type { ChatPassage, ChatTraceStep, ChatTurn } from '../../archive/types'
import { languageModel, modelName, modelSetting } from '../ai/models'
import { costOfCall } from '../ai/prices'
import {
  CALCULATION_TOOL,
  CALCULATIONS_USED_UP,
  NOTHING_FOUND,
  PARAMETERS_NOT_JSON,
  SEARCH_TOOL,
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
  history: readonly ChatTurn[]
  settings: ChatSettings
  /** Runs one hybrid search. */
  search: (query: string) => Promise<SearchStep>
  /** Receives every model call and every search as it ends, so a failed run still leaves a trace. */
  trace: (step: ChatTraceStep) => void
}

/** Answers a question from the archive. The rest of the chat knows this function only, never a model. */
export type Answerer = (input: AnswerInput) => Promise<string>

const aiAnswerer: Answerer = async ({
  question,
  instructions,
  history,
  settings,
  search,
  trace,
}) => {
  const model = modelName('chat')
  /** Searches and calculations of the step that is running; they follow its model call in the trace. */
  let searched: SearchStep[] = []
  let calculated: CalculationStep[] = []
  let stepStarted = Date.now()
  /** Steps that searched; a step may send several searches at once. */
  let searchSteps = 0
  const calculations = calculationBudget(settings)

  try {
    const { text } = await generateText({
      model: languageModel('chat'),
      telemetry: chatTelemetry(),
      instructions,
      messages: [
        ...history.map((turn) => ({
          role: turn.role === 'visitor' ? ('user' as const) : ('assistant' as const),
          content: turn.text,
        })),
        { role: 'user' as const, content: question },
      ],
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
            const step = await search(dotaz)
            searched.push(step)
            return step.passages.length === 0 ? NOTHING_FOUND : passagesForModel(step.passages)
          },
        }),
        [CALCULATION_TOOL]: calculationTool(calculations, (step) => calculated.push(step)),
      },
      // A safety net only: every step but the last uses up a search, a calculation or an errored run.
      stopWhen: stepCountIs(
        settings.maxSearches + settings.maxCalculations + settings.maxErroredRuns + 1,
      ),
      prepareStep: ({ stepNumber }) => {
        stepStarted = Date.now()
        // The first step must search, so a calculation always has passages to start from.
        if (stepNumber === 0) return { activeTools: [SEARCH_TOOL], toolChoice: 'required' }
        const active: (typeof SEARCH_TOOL | typeof CALCULATION_TOOL)[] = []
        if (searchSteps < settings.maxSearches) active.push(SEARCH_TOOL)
        if (calculations.allowed()) active.push(CALCULATION_TOOL)
        // With nothing left to use, the model must answer from what it has.
        if (active.length === 0) return { activeTools: [], toolChoice: 'none' }
        return { activeTools: active }
      },
      onStepEnd: (step) => {
        const tools = [...searched, ...calculated].reduce((sum, item) => sum + item.durationMs, 0)
        const inputTokens = step.usage.inputTokens ?? 0
        const outputTokens = step.usage.outputTokens ?? 0
        if (searched.length > 0) searchSteps += 1
        trace({
          kind: 'model',
          step: step.stepNumber + 1,
          model,
          text: step.text,
          searches: searched.map((item) => item.query),
          calculations: calculated.length,
          durationMs: Math.max(0, Date.now() - stepStarted - tools),
          inputTokens,
          outputTokens,
          costUsd: costOfCall(model, inputTokens, outputTokens),
        })
        for (const item of searched) trace(item)
        for (const item of calculated) trace(item)
        searched = []
        calculated = []
      },
    })
    return text
  } finally {
    // Searches and calculations of a step that failed before it ended.
    for (const item of searched) trace(item)
    for (const item of calculated) trace(item)
  }
}

type CalculationStep = Extract<ChatTraceStep, { kind: 'calculation' }>

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

/** Tokens the fake model reports for every call, so costs in tests are fixed. */
const FAKE_USAGE = { inputTokens: 1000, outputTokens: 100 }
const FAKE_QUOTE_CHARACTERS = 220

/** Amounts in crowns as documents write them, like "870 000 Kč". */
const AMOUNT = /(\d{1,3}(?: \d{3})+|\d+) Kč/g
const SUM_SCRIPT = 'return parametry.castky.reduce((soucet, castka) => soucet + castka, 0)'

/**
 * A stand-in for the test suite (`AI_CHAT_MODEL=fake:chat`): it searches with
 * the question as it is, and when that finds no piece by its words, once more
 * with the previous question in front, the way a model rewrites a follow-up.
 * The answer quotes the best piece. A question with "selhani" fails on purpose.
 * A question with "celkem" adds up the amounts in crowns of the found pieces in
 * the sandbox; with "chybny skript" as well, the first script has a syntax error.
 */
const fakeAnswerer: Answerer = async ({ question, history, settings, search, trace }) => {
  const model = modelName('chat')
  let step = 0
  const call = (text: string, searches: string[], calculations = 0) => {
    step += 1
    trace({
      kind: 'model',
      step,
      model,
      text,
      searches,
      calculations,
      durationMs: 1,
      ...FAKE_USAGE,
      costUsd: costOfCall(model, FAKE_USAGE.inputTokens, FAKE_USAGE.outputTokens),
    })
  }
  const byWords = (passages: readonly ChatPassage[]) =>
    passages.filter((passage) => passage.wordRank !== null)

  if (question.includes('selhani')) throw new Error('The fake chat model was asked to fail.')

  call('', [question])
  let found = await search(question)
  trace(found)

  const previous = history.filter((turn) => turn.role === 'visitor').at(-1)
  if (byWords(found.passages).length === 0 && previous !== undefined) {
    const wider = `${previous.text} ${question}`
    call('', [wider])
    found = await search(wider)
    trace(found)
  }

  if (question.includes('celkem')) {
    const counted = byWords(found.passages).flatMap((passage) => {
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
    return answer
  }

  const best = byWords(found.passages)[0]
  const answer =
    best === undefined
      ? 'V archivu jsem k tomu nic nenašel. Zkuste otázku napsat jinak.'
      : `Podle dokumentu „${best.documentTitle}“: ${best.text.slice(0, FAKE_QUOTE_CHARACTERS)} [${best.number}]`
  call(answer, [])
  return answer
}

export function getAnswerer(): Answerer {
  return modelSetting('chat').provider === 'fake' ? fakeAnswerer : aiAnswerer
}
