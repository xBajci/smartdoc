/**
 * What a model costs, in US dollars per million tokens: [input, output, cache
 * read, cache write]. The provider keeps the start of a prompt it has seen in a
 * cache; input read from there is cheaper, and with some providers input written
 * there costs more. Without the last two prices, that input costs as much as
 * the rest. Checked on 11 November 2026 against third-party price lists, the
 * cache prices on 23 November 2026; the provider's own price page decides.
 * `AI_PRICES` in `.env` adds to this table or corrects it, e.g.
 * AI_PRICES={"openai:gpt-5":[1.25,10,0.125]}.
 */
type Price = readonly [input: number, output: number, cacheRead?: number, cacheWrite?: number]

const KNOWN_PRICES: Record<string, Price> = {
  // OpenAI caches by itself and charges a write only in its explicit mode, which the chat does not use.
  'openai:gpt-6.1-sol': [2, 10, 0.1, 2.5],
  'openai:gpt-6.1-terra': [1, 5, 0.05, 1.25],
  'openai:gpt-6-luna': [0.1, 0.5, 0.01],
  // An embedding has no output tokens.
  'openai:text-embedding-3-small': [0.02, 0],
  // Checked on 12 November 2026, third-party lists only; output is free.
  'typesafe:jev-latest': [0.042, 0],
  // A cache write is the one that lasts 5 minutes: 1.25 times the input price.
  'anthropic:claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  // Valid for prompts up to 100,000 tokens; no request of this application is longer.
  'anthropic:claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
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

function isPrice(value: unknown): value is Price {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 4 &&
    value.every((item) => typeof item === 'number')
  )
}

function priceOf(model: string): Price | null {
  const configured = configuredPrices()[model]
  if (isPrice(configured)) return configured
  return KNOWN_PRICES[model] ?? null
}

/** Input tokens of a call that were read from the provider's cache or written to it. */
export interface CachedTokens {
  read: number
  written: number
}

const NOTHING_CACHED: CachedTokens = { read: 0, written: 0 }

/**
 * Cost of one call in US dollars, or `null` when the price of the model is not
 * known. `inputTokens` counts all of the input, the cached tokens included.
 */
export function costOfCall(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cached: CachedTokens = NOTHING_CACHED,
) {
  const price = priceOf(model)
  if (price === null) return null
  const [input, output, cacheRead = input, cacheWrite = input] = price
  const uncached = Math.max(0, inputTokens - cached.read - cached.written)
  return (
    (uncached * input +
      cached.read * cacheRead +
      cached.written * cacheWrite +
      outputTokens * output) /
    1_000_000
  )
}
