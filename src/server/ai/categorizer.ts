import { askJev } from './jev'
import { missingKey, modelSetting } from './models'

export interface CategoryChoice {
  name: string
  /** What belongs to the category, in the administrator's words; may be empty. */
  description: string
  /** The category for documents that fit no other. */
  isFallback: boolean
}

/** What the categorizer reads of a document. */
export interface CategorizedDocument {
  title: string
  filename: string
  description: string
  text: string
}

export interface Categorized {
  /** Name of the chosen category; `null` when the choice was not sure and there is no fallback. */
  category: string | null
  /** How likely each category is; they add up to one. */
  probabilities: Record<string, number>
  inputTokens: number
  outputTokens: number
  /** As written in `.env`: provider:model. */
  model: string
}

/** Picks the category of a document from those the archive has. */
export type Categorizer = (
  document: CategorizedDocument,
  categories: readonly CategoryChoice[],
  /** The skills for choosing a category, as one text; may be empty. */
  guidance: string,
) => Promise<Categorized>

/** How much of a text the choice is made from. The start of a document says what it is. */
const TEXT_CHARACTERS = 6000
/** AI_CATEGORY_CONFIDENCE: a choice less sure than this goes to the fallback category. */
function minimumConfidence(): number {
  const value = Number(process.env.AI_CATEGORY_CONFIDENCE)
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0.7
}

/** The most likely category, unless it is too unsure; then the fallback one. */
export function pickCategory(
  probabilities: Record<string, number>,
  categories: readonly CategoryChoice[],
  minimum: number,
): string | null {
  const best = categories
    .map((category) => ({ name: category.name, probability: probabilities[category.name] ?? 0 }))
    .sort((a, b) => b.probability - a.probability)[0]
  if (best !== undefined && best.probability >= minimum) return best.name
  return categories.find((category) => category.isFallback)?.name ?? null
}

/**
 * What the decision model is told about each category: a sentence that says
 * when a document belongs to it, and after it the administrator's own hint.
 */
export function categoryCriteria(categories: readonly CategoryChoice[]): Record<string, string> {
  return Object.fromEntries(
    categories.map((category) => {
      const rule = category.isFallback
        ? 'Žádná jiná kategorie dokumentu neodpovídá.'
        : `Dokument svým obsahem a účelem patří do kategorie „${category.name}“.`
      const hint = category.description.trim()
      return [category.name, hint === '' ? rule : `${rule} Co do kategorie patří: ${hint}`]
    }),
  )
}

/** Jev answers a question of choice with a probability for each category; one call per document. */
const jevCategorizer: Categorizer = async (document, categories, guidance) => {
  const { answers, ...usage } = await askJev(
    {
      nazev: document.title,
      soubor: document.filename,
      popis: document.description,
      text: document.text.slice(0, TEXT_CHARACTERS),
    },
    {
      kategorie: {
        type: 'choice',
        instructions:
          'Which category of a municipal archive does the document described by `nazev`, `popis` and `text` belong to? `soubor` is the name of its file and is only a hint.' +
          (guidance === '' ? '' : `\n\nRules of the archive (in Czech):\n${guidance}`),
        criteria: categoryCriteria(categories),
      },
    },
  )
  const probabilities = answers.kategorie?.probabilities
  if (probabilities === undefined) throw new Error('Jev gave no answer about the category.')
  return {
    category: pickCategory(probabilities, categories, minimumConfidence()),
    probabilities,
    ...usage,
  }
}

/**
 * A stand-in for the test suite (`AI_DECISION_MODEL=fake:decision`): a file
 * named "*zapis*" belongs to the minutes, when the archive has that category.
 */
const fakeCategorizer: Categorizer = (document, categories, _guidance) => {
  const minutes = categories.find((category) => category.name === 'Zápisy')
  const category =
    document.filename.includes('zapis') && minutes !== undefined ? minutes.name : null
  return Promise.resolve({
    category,
    probabilities: category === null ? {} : { [category]: 1 },
    inputTokens: 1000,
    outputTokens: 0,
    model: 'fake:decision',
  })
}

/** The categorizer, or `null` when the decision model is switched off or has no key. */
export function getCategorizer(): Categorizer | null {
  if (process.env.AI_DECISION_MODEL === 'off') return null
  const { provider } = modelSetting('decision')
  if (provider === 'fake') return fakeCategorizer
  if (provider !== 'typesafe') return null
  return missingKey('decision') === null ? jevCategorizer : null
}
