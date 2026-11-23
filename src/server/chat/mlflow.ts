import { LegacyOpenTelemetry } from '@ai-sdk/otel'
import { context, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import type { TelemetryOptions } from 'ai'
import type { ChatPassage } from '../../archive/types'

/**
 * The one place that knows MLflow. Every question to the chat becomes one
 * trace there, with the model calls and the searches under it, and the
 * visitor's word about an answer becomes feedback on that trace. Without
 * MLFLOW_TRACKING_URI nothing is sent, and a fault of MLflow never reaches the
 * visitor: the chat answers whether MLflow took the trace or not.
 *
 * The test questions use it too (`pnpm eval:sync`, `pnpm eval:run`): they keep
 * a dataset in MLflow and put the expected answer beside each answer, so the
 * judges set up in MLflow can score it.
 */

/** How long a call to MLflow may take before the chat stops waiting for it. */
const TIMEOUT_MS = 3000
/** The name the visitor's word has in MLflow. */
const FEEDBACK_NAME = 'helpful'

interface MlflowSettings {
  /** MLFLOW_TRACKING_URI: the address of the server, without a trailing slash. */
  url: string
  /** MLFLOW_EXPERIMENT_ID: the experiment the traces of the chat go to. */
  experimentId: string
  /** MLFLOW_TRACKING_USERNAME and MLFLOW_TRACKING_PASSWORD, as an Authorization header. */
  authorization: string | null
}

function mlflowSettings(): MlflowSettings | null {
  const url = process.env.MLFLOW_TRACKING_URI?.trim().replace(/\/+$/, '')
  if (!url) return null
  const user = process.env.MLFLOW_TRACKING_USERNAME
  const password = process.env.MLFLOW_TRACKING_PASSWORD
  return {
    url,
    experimentId: process.env.MLFLOW_EXPERIMENT_ID?.trim() || '0',
    authorization:
      user && password ? `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` : null,
  }
}

interface Tracing {
  provider: TracerProvider
  tracer: Tracer
  telemetry: LegacyOpenTelemetry
}

let tracing: Tracing | null | undefined
/** The run the traces go to, set by `startRun` before the first trace. */
let runId: string | null = null
/** Flushes started after a question, until they end. */
const flushing = new Set<Promise<void>>()

/** Starts the export on first use; `null` when MLflow is not set up. */
function getTracing(): Tracing | null {
  if (tracing !== undefined) return tracing
  const settings = mlflowSettings()
  if (settings === null) return (tracing = null)

  // Without it a span would not know its parent across an await.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  const exporter = new OTLPTraceExporter({
    url: `${settings.url}/v1/traces`,
    headers: {
      'x-mlflow-experiment-id': settings.experimentId,
      ...(runId === null ? {} : { 'x-mlflow-run-id': runId }),
      ...(settings.authorization === null ? {} : { Authorization: settings.authorization }),
    },
    timeoutMillis: TIMEOUT_MS,
  })
  // The provider stays private: the processing of documents makes no traces.
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'hm-archiv-chat' }),
    spanProcessors: [new BatchSpanProcessor({ exporter })],
  })
  const tracer = provider.getTracer('hm-archiv-chat')
  tracing = { provider, tracer, telemetry: new LegacyOpenTelemetry({ tracer }) }
  return tracing
}

/**
 * What an AI SDK call of the chat is given as `telemetry`. Inside a question
 * its spans go under the question's trace; anywhere else, such as the indexing
 * of documents that shares the embedder, the call records nothing.
 */
export function chatTelemetry(): TelemetryOptions {
  const current = getTracing()
  if (current === null || trace.getActiveSpan() === undefined) return { isEnabled: false }
  return { integrations: [current.telemetry] }
}

export interface TracedQuestion {
  question: string
  /** The id of the question in `chat_traces`, so a trace in MLflow leads back to it. */
  questionId: string
  sessionId: string
  /** More tags for the trace, such as the number of a test question. */
  tags?: Record<string, string>
}

/**
 * Runs one question to the chat as one trace in MLflow. `started` gets the
 * trace's id before the answer is made, so a question that fails keeps it
 * too; without MLflow it is never called. What `answer` throws is thrown
 * again, after the trace records it.
 */
export async function traceQuestion<Answer extends { text: string }>(
  question: TracedQuestion,
  answer: () => Promise<Answer>,
  started: (mlflowTraceId: string) => void,
): Promise<Answer> {
  const current = getTracing()
  if (current === null) return answer()

  return current.tracer.startActiveSpan('chat', async (span) => {
    span.setAttributes({
      'mlflow.spanType': 'CHAIN',
      'mlflow.spanInputs': JSON.stringify({ question: question.question }),
      // MLflow groups traces into sessions by this one and keeps the tag on the trace.
      'session.id': question.sessionId,
      'mlflow.traceTag.question_id': question.questionId,
      ...Object.fromEntries(
        Object.entries(question.tags ?? {}).map(([key, value]) => [
          `mlflow.traceTag.${key}`,
          value,
        ]),
      ),
    })
    // MLflow names a trace it got over OpenTelemetry by the trace id in hex.
    started(`tr-${span.spanContext().traceId}`)
    try {
      const answered = await answer()
      span.setAttribute('mlflow.spanOutputs', JSON.stringify(answered.text))
      return answered
    } catch (caught) {
      span.recordException(caught instanceof Error ? caught : String(caught))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw caught
    } finally {
      span.end()
      // Sent now, not with the next batch: feedback on a trace MLflow does not have yet is refused.
      const flush = current.provider
        .forceFlush()
        .catch((caught: unknown) => console.error('MLflow did not get a trace:', caught))
      flushing.add(flush)
      void flush.finally(() => flushing.delete(flush))
    }
  })
}

/**
 * Runs one search of a question as a step of its trace, with the pieces it
 * found as the documents of a retriever. The judges of MLflow that check
 * whether an answer stands on what was found read them from there.
 */
export async function traceSearch<T extends { passages: readonly ChatPassage[] }>(
  query: string,
  search: () => Promise<T>,
): Promise<T> {
  const current = getTracing()
  if (current === null || trace.getActiveSpan() === undefined) return search()

  return current.tracer.startActiveSpan('search', async (span) => {
    span.setAttributes({
      'mlflow.spanType': 'RETRIEVER',
      'mlflow.spanInputs': JSON.stringify({ query }),
    })
    try {
      const found = await search()
      span.setAttribute(
        'mlflow.spanOutputs',
        JSON.stringify(
          found.passages.map((passage) => ({
            id: String(passage.chunkId),
            page_content: passage.text,
            metadata: {
              doc_uri: `${passage.documentTitle}${passage.page === null ? '' : `, s. ${passage.page}`}`,
              number: passage.number,
              document_id: passage.documentId,
            },
          })),
        ),
      )
      return found
    } catch (caught) {
      span.recordException(caught instanceof Error ? caught : String(caught))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw caught
    } finally {
      span.end()
    }
  })
}

/**
 * Waits until every finished trace has reached MLflow. A flush that is
 * already sending a trace is waited for too: a new one finds nothing left to
 * send and would end before MLflow has that trace.
 */
export async function flushTraces(): Promise<void> {
  await Promise.all(flushing)
  await getTracing()?.provider.forceFlush()
}

export interface Feedback {
  mlflowTraceId: string
  /** The id MLflow gave the visitor's earlier word on this trace; `null` for the first word. */
  feedbackId: string | null
  helpful: boolean
  /** Who said it, as MLflow shows the source of the feedback. */
  visitor: string
}

/**
 * Puts the visitor's word on the trace of the answer in MLflow: the first
 * word is created, a changed one updates it, so a trace never has more than
 * one. Gives back the id of the feedback, or `null` when MLflow did not take
 * it. Never throws: the word is already stored in Postgres, MLflow is a copy.
 */
export async function sendFeedback(feedback: Feedback): Promise<string | null> {
  const settings = mlflowSettings()
  if (settings === null) return null
  const { mlflowTraceId, feedbackId, helpful, visitor } = feedback
  const assessments = `${settings.url}/api/3.0/mlflow/traces/${encodeURIComponent(mlflowTraceId)}/assessments`
  const request =
    feedbackId === null
      ? {
          url: assessments,
          method: 'POST',
          body: {
            assessment: {
              trace_id: mlflowTraceId,
              assessment_name: FEEDBACK_NAME,
              source: { source_type: 'HUMAN', source_id: visitor },
              feedback: { value: helpful },
            },
          },
        }
      : {
          url: `${assessments}/${encodeURIComponent(feedbackId)}`,
          method: 'PATCH',
          body: {
            assessment: {
              assessment_id: feedbackId,
              trace_id: mlflowTraceId,
              feedback: { value: helpful },
            },
            update_mask: 'feedback',
          },
        }
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        ...(settings.authorization === null ? {} : { Authorization: settings.authorization }),
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error(`MLflow refused feedback on ${mlflowTraceId}: ${response.status}`)
      return null
    }
    const { assessment } = (await response.json()) as { assessment?: { assessment_id?: string } }
    return assessment?.assessment_id ?? feedbackId
  } catch (caught) {
    console.error(`MLflow did not get feedback on ${mlflowTraceId}:`, caught)
    return null
  }
}

/** How long a call of the test questions may take; they run from a terminal, not for a visitor. */
const EVAL_TIMEOUT_MS = 30_000

/** A call for the test questions. Unlike the chat's, a fault stops the command. */
async function evalRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const settings = mlflowSettings()
  if (settings === null) throw new Error('MLFLOW_TRACKING_URI is not set; see .env.example.')
  const response = await fetch(`${settings.url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(settings.authorization === null ? {} : { Authorization: settings.authorization }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(EVAL_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`MLflow refused ${method} ${path}: ${response.status} ${detail}`)
  }
  return (await response.json()) as T
}

/** The address of a page of the MLflow UI in the experiment of the settings. */
export function mlflowPage(page: string): string {
  const settings = mlflowSettings()
  return settings === null ? '' : `${settings.url}/#/experiments/${settings.experimentId}/${page}`
}

/** A test question as a dataset of MLflow keeps it. */
export interface DatasetRecord {
  inputs: Record<string, unknown>
  /** What the judges compare an answer with, such as `expected_response`. */
  expectations: Record<string, unknown>
  tags: Record<string, string>
}

export interface StoredDatasetRecord extends DatasetRecord {
  id: string
}

/** The id of the dataset of that name in the experiment; a missing one is created. */
export async function findOrCreateDataset(name: string): Promise<string> {
  const experimentId = mlflowSettings()?.experimentId ?? '0'
  const found = await evalRequest<{ datasets?: { dataset_id: string }[] }>(
    'POST',
    '/api/3.0/mlflow/datasets/search',
    { experiment_ids: [experimentId], filter_string: `name = '${name.replaceAll("'", "\\'")}'` },
  )
  const existing = found.datasets?.[0]?.dataset_id
  if (existing !== undefined) return existing
  const created = await evalRequest<{ dataset: { dataset_id: string } }>(
    'POST',
    '/api/3.0/mlflow/datasets/create',
    { name, experiment_ids: [experimentId] },
  )
  return created.dataset.dataset_id
}

/** Every record of a dataset, also the ones added in the MLflow UI. */
export async function datasetRecords(datasetId: string): Promise<StoredDatasetRecord[]> {
  const records: StoredDatasetRecord[] = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ max_results: '1000', page_token: pageToken })
    const page = await evalRequest<{ records?: string; next_page_token?: string }>(
      'GET',
      `/api/3.0/mlflow/datasets/${encodeURIComponent(datasetId)}/records?${query}`,
    )
    // MLflow sends the records as one JSON string.
    const parsed = JSON.parse(page.records ?? '[]') as {
      dataset_record_id: string
      inputs?: Record<string, unknown>
      expectations?: Record<string, unknown> | null
      tags?: Record<string, string> | null
    }[]
    for (const record of parsed) {
      records.push({
        id: record.dataset_record_id,
        inputs: record.inputs ?? {},
        expectations: record.expectations ?? {},
        tags: record.tags ?? {},
      })
    }
    pageToken = page.next_page_token ?? ''
  } while (pageToken !== '')
  return records
}

/** Adds records; MLflow knows a record by its inputs, so one with the same inputs is updated. */
export async function upsertDatasetRecords(
  datasetId: string,
  records: readonly DatasetRecord[],
): Promise<{ inserted: number; updated: number }> {
  const result = await evalRequest<{ inserted_count?: number; updated_count?: number }>(
    'POST',
    `/api/3.0/mlflow/datasets/${encodeURIComponent(datasetId)}/records`,
    { records: JSON.stringify(records) },
  )
  return { inserted: result.inserted_count ?? 0, updated: result.updated_count ?? 0 }
}

export async function deleteDatasetRecords(
  datasetId: string,
  recordIds: readonly string[],
): Promise<void> {
  if (recordIds.length === 0) return
  await evalRequest('DELETE', `/api/3.0/mlflow/datasets/${encodeURIComponent(datasetId)}/records`, {
    dataset_record_ids: recordIds,
  })
}

/**
 * Starts a run in the experiment; every trace made after it goes to the run,
 * so runs can be compared in the MLflow UI. It must come before the first trace.
 */
export async function startRun(name: string, params: Record<string, string>): Promise<string> {
  if (tracing !== undefined) throw new Error('A run must start before the first trace.')
  const experimentId = mlflowSettings()?.experimentId ?? '0'
  const created = await evalRequest<{ run: { info: { run_id: string } } }>(
    'POST',
    '/api/2.0/mlflow/runs/create',
    { experiment_id: experimentId, run_name: name, start_time: Date.now() },
  )
  runId = created.run.info.run_id
  await evalRequest('POST', '/api/2.0/mlflow/runs/log-batch', {
    run_id: runId,
    params: Object.entries(params).map(([key, value]) => ({ key, value })),
  })
  return runId
}

export async function endRun(failed: boolean): Promise<void> {
  if (runId === null) return
  await evalRequest('POST', '/api/2.0/mlflow/runs/update', {
    run_id: runId,
    status: failed ? 'FAILED' : 'FINISHED',
    end_time: Date.now(),
  })
}

/** Puts what the answer should be beside it in MLflow, one expectation per name. */
export async function logExpectations(
  mlflowTraceId: string,
  expectations: Record<string, unknown>,
  source: string,
): Promise<void> {
  for (const [name, value] of Object.entries(expectations)) {
    await evalRequest(
      'POST',
      `/api/3.0/mlflow/traces/${encodeURIComponent(mlflowTraceId)}/assessments`,
      {
        assessment: {
          trace_id: mlflowTraceId,
          assessment_name: name,
          source: { source_type: 'HUMAN', source_id: source },
          expectation: { value },
        },
      },
    )
  }
}
