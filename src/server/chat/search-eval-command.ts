import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import type { ChatHit, ChatTraceStep } from '../../archive/types'
import { closeDatabase, getDatabase } from '../../db/client'
import { documents } from '../../db/schema'
import { instructionsFor } from '../ai/skills'
import { loadSkills } from '../skills-service'
import { getAnswerer } from './answerer'
import { getEmbedder } from './embedder'
import { fuseRanks } from './fusion'
import { chatFixed, rewriteFixed } from './instructions'
import { hybridSearch, searchByMeaning, searchByWords } from './retrieval'
import { getRewriter } from './rewriter'
import { parseSearchQuestions, ranksOfDocuments, type SearchQuestion } from './search-questions'
import { chatSettings } from './settings'

// `pnpm search:eval` — runs the questions of docs/tests/search-questions.md
// against the database and prints where each branch of the search ranks the
// documents that hold the answer. The reranker is left out in both modes.
//
// Without arguments the question goes in as written: no model, nothing to
// pay, and two runs over the same data give the same numbers.
// `--model` lets the models write the searches the way they do in the app, with
// the same instructions and skills: the rewrite model the first search, the chat
// model the ones after it. A document then counts at the best
// place any of its searches gave it. It costs a little and varies between runs.
const QUESTIONS_FILE = 'docs/tests/search-questions.md'
const BRANCHES = ['slova', 'význam', 'spojení'] as const
type Branch = (typeof BRANCHES)[number]
type Ranks = Record<Branch, (number | null)[]>

const byModel = process.argv.includes('--model')
const settings = chatSettings()
const scope = { scope: 'archive' as const, documentIds: [] }
const embed = getEmbedder()
const questions = parseSearchQuestions(readFileSync(QUESTIONS_FILE, 'utf8'))

const ready = await getDatabase()
  .select({ id: documents.id, title: documents.title })
  .from(documents)
  .where(eq(documents.status, 'ready'))

/** The id of every expected document; a title that fits no document or several stops the run. */
function documentIdsOf(question: SearchQuestion): string[] {
  return question.documents.map(({ title }) => {
    const fitting = ready.filter((row) => row.title.startsWith(title))
    if (fitting.length !== 1) {
      throw new Error(
        `Question ${question.number}: "${title}" fits ${fitting.length} documents, it must fit one.`,
      )
    }
    return fitting[0]?.id ?? ''
  })
}

/** Where one search puts each expected document, in each branch and in their fusion. */
function ranksOf(words: ChatHit[], meaning: ChatHit[], ids: string[]): Ranks {
  const documentOf = new Map([...words, ...meaning].map((hit) => [hit.chunkId, hit.documentId]))
  const fused = fuseRanks(words, meaning, settings.rrfK, Infinity).map((item) => ({
    documentId: documentOf.get(item.chunkId) ?? '',
  }))
  return {
    slova: ranksOfDocuments(words, ids),
    význam: ranksOfDocuments(meaning, ids),
    spojení: ranksOfDocuments(fused, ids),
  }
}

/** The best place of each document over several searches. */
function bestOf(all: Ranks[], count: number): Ranks {
  const best = (branch: Branch) =>
    Array.from({ length: count }, (_, index) => {
      const places = all.flatMap((ranks) => ranks[branch][index] ?? [])
      return places.length === 0 ? null : Math.min(...places)
    })
  return { slova: best('slova'), význam: best('význam'), spojení: best('spojení') }
}

async function asWritten(question: SearchQuestion, ids: string[]) {
  const [words, embedded] = await Promise.all([
    searchByWords(question.question, scope, settings.branchLimit),
    embed([question.question]),
  ])
  const meaning = await searchByMeaning(
    embedded.vectors[0] ?? [],
    embedded.model,
    scope,
    settings.branchLimit,
  )
  return { queries: [question.question], ranks: ranksOf(words, meaning, ids), costUsd: 0 }
}

const skills = await loadSkills()
const rewriteInstructions = instructionsFor(skills, 'chat-rewrite', rewriteFixed())
const answerInstructions = instructionsFor(skills, 'chat-answer', chatFixed())

async function asTheModelWrites(question: SearchQuestion, ids: string[]) {
  const numbers = new Map<number, number>()
  const numberOf = (chunkId: number) =>
    numbers.get(chunkId) ?? numbers.set(chunkId, numbers.size + 1).size
  const tools = { embed, decider: null, rerankGuidance: '', settings, numberOf }
  const search = (query: string) => hybridSearch(question.question, query, scope, tools)
  const rewrite = await getRewriter()({
    question: question.question,
    history: [],
    instructions: rewriteInstructions.text,
  })
  const found = await Promise.all(rewrite.queries.map(search))
  const steps: ChatTraceStep[] = [rewrite, ...found]
  await getAnswerer()({
    question: question.question,
    instructions: answerInstructions.text,
    history: [],
    settings,
    found,
    search,
    trace: (step) => steps.push(step),
  })
  const searches = steps.flatMap((step) => (step.kind === 'search' ? [step] : []))
  const costUsd = steps.reduce(
    (sum, step) =>
      sum + (step.kind === 'model' || step.kind === 'rewrite' ? (step.costUsd ?? 0) : 0),
    0,
  )
  return {
    queries: searches.map((step) => step.query),
    ranks: bestOf(
      searches.map((step) => ranksOf(step.words, step.meaning, ids)),
      ids.length,
    ),
    costUsd,
  }
}

const answerable = questions.filter((question) => question.documents.length > 0)
const results = await Promise.all(
  answerable.map(async (question) => {
    const ids = documentIdsOf(question)
    const run = byModel ? asTheModelWrites : asWritten
    return { question, ...(await run(question, ids)) }
  }),
)

const seen = (rank: number | null) => rank !== null && rank <= settings.passages
const shown = (ranks: (number | null)[]) => ranks.map((rank) => rank ?? '–').join('/')

console.log(byModel ? 'Dotazy píše chatovací model.' : 'Dotaz je otázka tak, jak je napsaná.')
console.log(
  `Místo prvního kousku každého správného dokumentu (– = není v prvních ${settings.branchLimit}).`,
)
console.log(`Model dostane prvních ${settings.passages} kousků z každého hledání.\n`)
console.log(['#', 'otázka', ...BRANCHES].join('\t'))
for (const { question, ranks, queries } of results) {
  const cells = BRANCHES.map((branch) => shown(ranks[branch]))
  console.log([question.number, question.name, ...cells].join('\t'))
  if (byModel) for (const query of queries) console.log(`\t  hledal: ${query}`)
}

console.log(`\nOtázek s odpovědí: ${results.length}`)
for (const branch of BRANCHES) {
  const some = results.filter(({ ranks }) => ranks[branch].some(seen)).length
  const all = results.filter(({ ranks }) => ranks[branch].every(seen)).length
  console.log(
    `${branch}: aspoň jeden dokument v prvních ${settings.passages}: ${some}, všechny: ${all}`,
  )
}
if (byModel) {
  const cost = results.reduce((sum, result) => sum + result.costUsd, 0)
  console.log(`Cena volání chatovacího modelu: ${cost.toFixed(3)} USD`)
}
const unanswerable = questions.filter((question) => question.documents.length === 0)
if (unanswerable.length > 0) {
  const numbers = unanswerable.map((question) => question.number).join(', ')
  console.log(`\nBez odpovědi v archivu (hledání je neměří, jen chat): ${numbers}`)
}

await closeDatabase()
