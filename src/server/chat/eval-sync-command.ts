import { readFileSync } from 'node:fs'
import { DATASET_NAME, QUESTIONS_FILE, recordOf, staleRecords } from './eval-dataset'
import {
  datasetRecords,
  deleteDatasetRecords,
  findOrCreateDataset,
  mlflowPage,
  upsertDatasetRecords,
} from './mlflow'
import { parseSearchQuestions } from './search-questions'

// `pnpm eval:sync` — copies the questions of docs/tests/search-questions.md
// into the dataset of MLflow that `pnpm eval:run` asks. The file stays the
// one to edit; records added to the dataset in the MLflow UI are kept.
// MLflow is set in `.env.eval`, see `.env.example`.

const fresh = parseSearchQuestions(readFileSync(QUESTIONS_FILE, 'utf8')).map(recordOf)
const datasetId = await findOrCreateDataset(DATASET_NAME)
const stale = staleRecords(await datasetRecords(datasetId), fresh)
await deleteDatasetRecords(datasetId, stale)
const { inserted, updated } = await upsertDatasetRecords(datasetId, fresh)

console.log(`Dataset ${DATASET_NAME}: otázek ze souboru ${fresh.length}.`)
console.log(`Nových ${inserted}, aktualizovaných ${updated}, smazaných ${stale.length}.`)
console.log(mlflowPage('datasets'))
