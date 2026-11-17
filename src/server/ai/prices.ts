/**
 * What a model costs, in US dollars per million tokens: [input, output].
 * Checked on 11 November 2026 against third-party price lists; the provider's
 * own price page decides. `AI_PRICES` in `.env` adds to this table or corrects
 * it, e.g. AI_PRICES={"openai:gpt-5":[1.25,10]}.
 */
const KNOWN_PRICES: Record<string, readonly [number, number]> = {
  'openai:gpt-6.1-sol': [2, 10],
  'openai:gpt-6.1-terra': [1, 5],
  'openai:gpt-6-luna': [0.1, 0.5],
  // An embedding has no output tokens.
  'openai:text-embedding-3-small': [0.02, 0],
  // Checked on 12 November 2026, third-party lists only; output is free.
  'typesafe:jev-latest': [0.042, 0],
  'anthropic:claude-sonnet-5-5': [2, 10],
  // Valid for prompts up to 100,000 tokens; no request of this application is longer.
  'anthropic:claude-haiku-5-5': [0.1, 0.5],
}

function configuredPrices(): Record<string, unknown> {
  const raw = process.env.AI_PRICES
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    console.error('AI_PRICES is not valid JSON and was ignored.')
    return {}
  }
}

function priceOf(model: string): readonly [number, number] | null {
  const configured = configuredPrices()[model]
  if (
    Array.isArray(configured) &&
    typeof configured[0] === 'number' &&
    typeof configured[1] === 'number'
  ) {
    return [configured[0], configured[1]]
  }
  return KNOWN_PRICES[model] ?? null
}

/** Cost of one call in US dollars, or `null` when the price of the model is not known. */
export function costOfCall(model: string, inputTokens: number, outputTokens: number) {
  const price = priceOf(model)
  if (price === null) return null
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000
}
