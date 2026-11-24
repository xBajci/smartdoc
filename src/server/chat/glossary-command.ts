import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { generateText } from 'ai'
import { eq } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../../db/client'
import { categories, documents } from '../../db/schema'
import { costOfCalls, recorded, storeCalls, type ModelCall } from '../ai/calls'
import { languageModel, missingKey, modelName } from '../ai/models'
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
console.log(`Píšu glosář z ${rows.length} dokumentů modelem ${model}…`)
const calls: ModelCall[] = []
// A call that fails stops the command here, and nothing is written.
const text = await recorded(
  (call) => calls.push(call),
  model,
  {
    operation: 'glossary',
    skillKey: null,
    skills: null,
    page: null,
    input: `Dokumentů: ${rows.length}`,
  },
  async () => {
    const written = await generateText({
      model: languageModel('glossary'),
      instructions: GLOSSARY_INSTRUCTIONS,
      messages: [{ role: 'user', content: input }],
    })
    return { value: written.text, output: written.text, usage: written.usage }
  },
)
await writeFile(GLOSSARY_FILE, glossarySkillFile(text))

await storeCalls(
  { runId: randomUUID(), documentId: null, title: 'Glosář chatu', format: null },
  calls,
)
await closeDatabase()

const costUsd = costOfCalls(calls)
console.log(
  `Glosář je v ${GLOSSARY_FILE}. Cena: ${costUsd === null ? 'neznámá' : `$${costUsd.toFixed(3)}`}.`,
)
console.log(`Zkontroluj ho a pošli do aplikace: pnpm skills:push ${GLOSSARY_SKILL}`)
