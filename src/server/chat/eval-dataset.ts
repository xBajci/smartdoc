import type { DatasetRecord, StoredDatasetRecord } from './mlflow'
import type { SearchQuestion } from './search-questions'

/** The dataset of test questions in MLflow. */
export const DATASET_NAME = 'hm-archiv-otazky'
/** Where the test questions are written; their records in MLflow carry it as `source`. */
export const QUESTIONS_FILE = 'docs/tests/search-questions.md'

/**
 * A test question as a record of the dataset. The judges of MLflow compare an
 * answer with `expected_response`; the documents are there for a person.
 */
export function recordOf(question: SearchQuestion): DatasetRecord {
  return {
    inputs: { question: question.question },
    expectations: {
      expected_response: question.answer,
      ...(question.documents.length === 0
        ? {}
        : {
            expected_documents: question.documents.map(
              (document) => `${document.title}, s. ${document.pages}`,
            ),
          }),
    },
    tags: {
      source: QUESTIONS_FILE,
      number: String(question.number),
      name: question.name,
      trap: question.trap,
    },
  }
}

/**
 * Records of the questions file that it no longer holds as they are: the
 * question was changed or removed, or it lost an expectation, which an update
 * of MLflow would keep. Records added in the MLflow UI are left alone.
 */
export function staleRecords(
  stored: readonly StoredDatasetRecord[],
  fresh: readonly DatasetRecord[],
): string[] {
  const expected = new Map(
    fresh.map((record) => [record.inputs.question, Object.keys(record.expectations).sort().join()]),
  )
  return stored
    .filter((record) => record.tags.source === QUESTIONS_FILE)
    .filter(
      (record) =>
        expected.get(record.inputs.question) !== Object.keys(record.expectations).sort().join(),
    )
    .map((record) => record.id)
}
