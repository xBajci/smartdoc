import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { EmbeddingModel, LanguageModel } from 'ai'

/**
 * The one place that knows AI providers. A model is named in `.env` as
 * `provider:model`, so a model is changed without touching code.
 */
export type ModelRole = 'ocr' | 'description' | 'chat' | 'embedding' | 'decision'

const PROVIDERS = ['anthropic', 'openai', 'typesafe', 'fake'] as const
export type ModelProvider = (typeof PROVIDERS)[number]

export interface ModelSetting {
  provider: ModelProvider
  model: string
}

const SETTINGS: Record<ModelRole, { variable: string; fallback: string }> = {
  // Reads scanned pages and looks at images.
  ocr: { variable: 'AI_OCR_MODEL', fallback: 'openai:gpt-6.1-terra' },
  // Writes the short description and the name from text that is already extracted.
  description: { variable: 'AI_DESCRIPTION_MODEL', fallback: 'openai:gpt-6-luna' },
  // Reads recorded sessions and proposes better skills. Runs rarely, so it may be the strongest.
  // Answers visitors' questions from pieces of documents; must be able to call a tool.
  chat: { variable: 'AI_CHAT_MODEL', fallback: 'openai:gpt-6.1-terra' },
  // Turns a text into a vector of 1536 numbers, for the search by meaning.
  embedding: { variable: 'AI_EMBEDDING_MODEL', fallback: 'openai:text-embedding-3-small' },
  // Weighs the two branches of the chat search and scores the found pieces; `off` switches both off.
  decision: { variable: 'AI_DECISION_MODEL', fallback: 'typesafe:jev-latest' },
}

const KEY_VARIABLES = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
} as const

export function parseModelSetting(value: string): ModelSetting {
  const separator = value.indexOf(':')
  const provider = value.slice(0, separator) as ModelProvider
  const model = value.slice(separator + 1)
  if (separator < 1 || model === '' || !PROVIDERS.includes(provider)) {
    throw new Error(`"${value}" is not a model setting. Use provider:model, e.g. openai:gpt-5.`)
  }
  return { provider, model }
}

export function modelSetting(role: ModelRole): ModelSetting {
  const { variable, fallback } = SETTINGS[role]
  return parseModelSetting(process.env[variable] || fallback)
}

/** Name of the environment variable whose key this role needs and does not have, or `null`. */
export function missingKey(role: ModelRole): string | null {
  const { provider } = modelSetting(role)
  if (provider === 'fake') return null
  const variable = KEY_VARIABLES[provider]
  return process.env[variable] ? null : variable
}

/** The setting as one string, the way it is written in `.env` and stored with each call. */
export function modelName(role: ModelRole): string {
  const { provider, model } = modelSetting(role)
  return `${provider}:${model}`
}

export function embeddingModel(): EmbeddingModel {
  const { provider, model } = modelSetting('embedding')
  if (provider === 'openai') return createOpenAI().embeddingModel(model)
  throw new Error(`The provider "${provider}" has no embedding model here.`)
}

export function languageModel(role: ModelRole): LanguageModel {
  const { provider, model } = modelSetting(role)
  if (provider === 'anthropic') return createAnthropic()(model)
  if (provider === 'openai') return createOpenAI()(model)
  throw new Error(`The provider "${provider}" has no language model here.`)
}
