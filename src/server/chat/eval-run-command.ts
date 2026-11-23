import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeDatabase } from '../../db/client'
import { modelName } from '../ai/models'
import { answerQuestion } from './chat-service'
import { DATASET_NAME } from './eval-dataset'
import { NO_HISTORY } from './history'
import {
  datasetRecords,
  endRun,
  findOrCreateDataset,
  flushTraces,
  logExpectations,
  mlflowPage,
  startRun,
} from './mlflow'
import { chatSettings } from './settings'

// `pnpm eval:run` — asks the chat every question of the dataset in MLflow,
// the way a visitor does, over the database in `.env`. Each answer becomes a
// trace in one run of the experiment in `.env.eval`, with the expected answer
// beside it; the judges set up in MLflow then score it. Nothing is written to
// the database. It pays for the model calls, so it runs when asked to.

/** Questions asked at the same time. */
const AT_ONCE = 4

const records = await datasetRecords(await findOrCreateDataset(DATASET_NAME))
const questions = records.flatMap((record) =>
  typeof record.inputs.question === 'string' ? [{ record, question: record.inputs.question }] : [],
)
if (questions.length === 0) throw new Error(`Dataset ${DATASET_NAME} is empty; run pnpm eval:sync.`)

const settings = chatSettings()
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const commit = `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') === '' ? '' : '+'}`
const runId = await startRun(`${new Date().toISOString().slice(0, 16)} ${commit}`, {
  git_commit: commit,
  chat_model: modelName('chat'),
  embedding_model: modelName('embedding'),
  dataset: DATASET_NAME,
  questions: String(questions.length),
  ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, String(value)])),
})

const results: { question: string; number: string; error: string | null; costUsd: number }[] = []
const queue = [...questions]
await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const { record, question } = next
      const answered = await answerQuestion({
        question,
        scope: { scope: 'archive', documentIds: [] },
        history: NO_HISTORY,
        settings,
        questionId: randomUUID(),
        sessionId: randomUUID(),
        tags: { dataset_record_id: record.id, question_number: record.tags.number ?? '' },
      })
      // Expectations go on a trace MLflow already has.
      await flushTraces()
      if (answered.mlflowTraceId !== null) {
        await logExpectations(answered.mlflowTraceId, record.expectations, DATASET_NAME)
      }
      results.push({
        question,
        number: record.tags.number ?? '',
        error: answered.error,
        costUsd: answered.steps.reduce(
          (sum, step) => sum + (step.kind === 'model' ? (step.costUsd ?? 0) : 0),
          0,
        ),
      })
      console.log(`${answered.error === null ? 'ok' : 'CHYBA'}\t${question}`)
    }
  }),
)

const failed = results.filter((result) => result.error !== null)
await endRun(failed.length > 0)
await closeDatabase()

const cost = results.reduce((sum, result) => sum + result.costUsd, 0)
console.log(`\nOtázek ${results.length}, bez odpovědi ${failed.length}.`)
for (const { number, question, error } of failed) console.log(`  ${number}\t${question}: ${error}`)
console.log(`Cena volání chatovacího modelu: ${cost.toFixed(3)} USD`)
console.log(`Běh v MLflow: ${mlflowPage(`runs/${runId}`)}`)
