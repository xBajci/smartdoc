import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { generateText } from 'ai'
import { eq } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../../db/client'
import { aiUsage, categories, documents } from '../../db/schema'
import { languageModel, missingKey, modelName } from '../ai/models'
import { costOfCall } from '../ai/prices'
import {
  GLOSSARY_FILE,
  GLOSSARY_INSTRUCTIONS,
  GLOSSARY_SKILL,
  glossaryInput,
  glossarySkillFile,
} from './glossary'

// `pnpm glossary:build` — writes the glossary of the chat anew from the name,
// category, year and short description of every public document. Run it again
// when many documents were added, check the file, then send it to the
// application with `pnpm skills:push chat/glosar`.
const missing = missingKey('glossary')
if (missing !== null) {
  console.error(`Chybí klíč ${missing} pro AI_GLOSSARY_MODEL.`)
  process.exit(1)
}

const database = getDatabase()
const rows = await database
  .select({
    title: documents.title,
    customDescription: documents.customDescription,
    shortDescription: documents.shortDescription,
    category: categories.name,
    year: documents.issuedYear,
  })
  .from(documents)
  .innerJoin(categories, eq(documents.categoryId, categories.id))
  .where(eq(documents.status, 'ready'))

const input = glossaryInput(
  rows.map((row) => ({
    title: row.title,
    description: row.customDescription || row.shortDescription,
    category: row.category,
    year: row.year,
  })),
)
const model = modelName('glossary')
const started = Date.now()
console.log(`Píšu glosář z ${rows.length} dokumentů modelem ${model}…`)
const { text, usage } = await generateText({
  model: languageModel('glossary'),
  instructions: GLOSSARY_INSTRUCTIONS,
  messages: [{ role: 'user', content: input }],
})
await writeFile(GLOSSARY_FILE, glossarySkillFile(text))

const inputTokens = usage.inputTokens ?? 0
const outputTokens = usage.outputTokens ?? 0
const costUsd = costOfCall(model, inputTokens, outputTokens)
await database.insert(aiUsage).values({
  runId: randomUUID(),
  documentTitle: 'Glosář chatu',
  operation: 'glossary',
  model,
  input: `Dokumentů: ${rows.length}`,
  output: text,
  durationMs: Date.now() - started,
  inputTokens,
  outputTokens,
  costUsd,
})
await closeDatabase()

console.log(
  `Glosář je v ${GLOSSARY_FILE}. Cena: ${costUsd === null ? 'neznámá' : `$${costUsd.toFixed(3)}`}.`,
)
console.log(`Zkontroluj ho a pošli do aplikace: pnpm skills:push ${GLOSSARY_SKILL}`)
