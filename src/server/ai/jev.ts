import { modelName, modelSetting } from './models'

/**
 * Jev of TypeSafe: a model that answers typed questions about a state with
 * probabilities instead of text. The chat uses it for small decisions, see
 * `AI_DECISION_MODEL`.
 */
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const TIMEOUT_MS = 15_000

export type JevQuestion =
  /** A yes/no question; the answer is the probability of yes. */
  | { type: 'noul'; instructions: string }
  /** One of the named choices; the answer has a probability for each. */
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }

export interface JevAnswer {
  noul?: number
  choice?: string
  confidence?: number
  probabilities?: Record<string, number>
}

export interface JevResult {
  answers: Record<string, JevAnswer | undefined>
  inputTokens: number
  outputTokens: number
  /** As written in `.env`: provider:model. */
  model: string
}

export async function askJev(
  state: Record<string, string>,
  questions: Record<string, JevQuestion>,
): Promise<JevResult> {
  const response = await fetch(TYPESAFE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: modelSetting('decision').model, state, questions }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `TypeSafe answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    )
  }
  const body = (await response.json()) as {
    answers?: Record<string, JevAnswer | undefined>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  return {
    answers: body.answers ?? {},
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    model: modelName('decision'),
  }
}
