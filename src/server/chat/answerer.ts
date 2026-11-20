import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import type { ChatPassage, ChatTraceStep, ChatTurn } from '../../archive/types'
import { languageModel, modelName, modelSetting } from '../ai/models'
import { costOfCall } from '../ai/prices'
import { NOTHING_FOUND, SEARCH_TOOL } from './instructions'
import { chatTelemetry } from './mlflow'
import { passagesForModel, type SearchStep } from './retrieval'
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
  /** Searches of the step that is running; they follow its model call in the trace. */
  let searched: SearchStep[] = []
  let stepStarted = Date.now()

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
      },
      // One step is one model call: every search but the last allowed is followed by another.
      stopWhen: stepCountIs(settings.maxSearches + 1),
      prepareStep: ({ stepNumber }) => {
        stepStarted = Date.now()
        // The first step must search; the last one must answer from what it has.
        if (stepNumber === 0) return { toolChoice: 'required' }
        if (stepNumber >= settings.maxSearches) return { toolChoice: 'none' }
        return undefined
      },
      onStepEnd: (step) => {
        const searching = searched.reduce((sum, item) => sum + item.durationMs, 0)
        const inputTokens = step.usage.inputTokens ?? 0
        const outputTokens = step.usage.outputTokens ?? 0
        trace({
          kind: 'model',
          step: step.stepNumber + 1,
          model,
          text: step.text,
          searches: searched.map((item) => item.query),
          durationMs: Math.max(0, Date.now() - stepStarted - searching),
          inputTokens,
          outputTokens,
          costUsd: costOfCall(model, inputTokens, outputTokens),
        })
        for (const item of searched) trace(item)
        searched = []
      },
    })
    return text
  } finally {
    // Searches of a step that failed before it ended.
    for (const item of searched) trace(item)
  }
}

/** Tokens the fake model reports for every call, so costs in tests are fixed. */
const FAKE_USAGE = { inputTokens: 1000, outputTokens: 100 }
const FAKE_QUOTE_CHARACTERS = 220

/**
 * A stand-in for the test suite (`AI_CHAT_MODEL=fake:chat`): it searches with
 * the question as it is, and when that finds no piece by its words, once more
 * with the previous question in front, the way a model rewrites a follow-up.
 * The answer quotes the best piece. A question with "selhani" fails on purpose.
 */
const fakeAnswerer: Answerer = async ({ question, history, search, trace }) => {
  const model = modelName('chat')
  let step = 0
  const call = (text: string, searches: string[]) => {
    step += 1
    trace({
      kind: 'model',
      step,
      model,
      text,
      searches,
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
