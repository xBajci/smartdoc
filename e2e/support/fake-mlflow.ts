/**
 * A stand-in for the MLflow server, run by Playwright beside the application
 * (`node e2e/support/fake-mlflow.ts`). It takes traces and feedback the way
 * MLflow does and keeps what it got, so a test can read it at `/recorded`.
 * Imports nothing but Node, because it runs without a build.
 */
import { createServer } from 'node:http'

export const FAKE_MLFLOW_PORT = 3221

export interface MlflowRecord {
  /** `feedback` creates the visitor's word on a trace, `feedback-update` changes it. */
  kind: 'trace' | 'feedback' | 'feedback-update'
  authorization: string | null
  experimentId: string | null
  /** For a trace, its OTLP body in hex, so a test can find a trace id in it. */
  body: string
  /** For feedback, the trace id in the address. */
  traceId: string | null
  /** For a changed word, the id of the feedback in the address. */
  feedbackId: string | null
}

const records: MlflowRecord[] = []
const FEEDBACK_PATH = /^\/api\/3\.0\/mlflow\/traces\/([^/]+)\/assessments(?:\/([^/]+))?$/

const server = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks)
    const header = (name: string) => {
      const value = request.headers[name]
      return typeof value === 'string' ? value : null
    }
    const feedback = FEEDBACK_PATH.exec(request.url ?? '')

    if (request.method === 'POST' && request.url === '/v1/traces') {
      records.push({
        kind: 'trace',
        authorization: header('authorization'),
        experimentId: header('x-mlflow-experiment-id'),
        body: body.toString('hex'),
        traceId: null,
        feedbackId: null,
      })
      response.writeHead(200, { 'Content-Type': 'application/x-protobuf' }).end()
    } else if (feedback !== null && ['POST', 'PATCH'].includes(request.method ?? '')) {
      const created = request.method === 'POST'
      const feedbackId = created ? `a-${records.length + 1}` : decodeURIComponent(feedback[2] ?? '')
      records.push({
        kind: created ? 'feedback' : 'feedback-update',
        authorization: header('authorization'),
        experimentId: null,
        body: body.toString('utf8'),
        traceId: decodeURIComponent(feedback[1] ?? ''),
        feedbackId: created ? null : feedbackId,
      })
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ assessment: { assessment_id: feedbackId } }))
    } else if (request.method === 'GET' && request.url === '/recorded') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(records))
    } else if (request.method === 'DELETE' && request.url === '/recorded') {
      records.length = 0
      response.writeHead(204).end()
    } else if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200).end('OK')
    } else {
      response.writeHead(404).end()
    }
  })
})

// Started only as a program, not when a test imports the port and the types.
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(FAKE_MLFLOW_PORT, '127.0.0.1')
}
