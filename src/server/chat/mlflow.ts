import { LegacyOpenTelemetry } from '@ai-sdk/otel'
import { context, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import type { TelemetryOptions } from 'ai'

/**
 * The one place that knows MLflow. Every question to the chat becomes one
 * trace there, with the model calls and the searches under it, and the
 * visitor's word about an answer becomes feedback on that trace. Without
 * MLFLOW_TRACKING_URI nothing is sent, and a fault of MLflow never reaches the
 * visitor: the chat answers whether MLflow took the trace or not.
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
}

/**
 * Runs one question to the chat as one trace in MLflow. `started` gets the
 * trace's id before the answer is made, so a question that fails keeps it
 * too; without MLflow it is never called. What `answer` throws is thrown
 * again, after the trace records it.
 */
export async function traceQuestion(
  question: TracedQuestion,
  answer: () => Promise<string>,
  started: (mlflowTraceId: string) => void,
): Promise<string> {
  const current = getTracing()
  if (current === null) return answer()

  return current.tracer.startActiveSpan('chat', async (span) => {
    span.setAttributes({
      'mlflow.spanType': 'CHAIN',
      'mlflow.spanInputs': JSON.stringify({ question: question.question }),
      // MLflow groups traces into sessions by this one and keeps the tag on the trace.
      'session.id': question.sessionId,
      'mlflow.traceTag.question_id': question.questionId,
    })
    // MLflow names a trace it got over OpenTelemetry by the trace id in hex.
    started(`tr-${span.spanContext().traceId}`)
    try {
      const text = await answer()
      span.setAttribute('mlflow.spanOutputs', JSON.stringify(text))
      return text
    } catch (caught) {
      span.recordException(caught instanceof Error ? caught : String(caught))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw caught
    } finally {
      span.end()
      // Sent now, not with the next batch: feedback on a trace MLflow does not have yet is refused.
      current.provider
        .forceFlush()
        .catch((caught: unknown) => console.error('MLflow did not get a trace:', caught))
    }
  })
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
