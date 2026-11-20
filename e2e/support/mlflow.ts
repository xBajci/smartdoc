import { MLFLOW_URL } from './environment'
import type { MlflowRecord } from './fake-mlflow'

/** What the stand-in for MLflow got since it was last cleared, oldest first. */
export async function mlflowRecords(): Promise<MlflowRecord[]> {
  const response = await fetch(`${MLFLOW_URL}/recorded`)
  return (await response.json()) as MlflowRecord[]
}

export async function clearMlflowRecords() {
  await fetch(`${MLFLOW_URL}/recorded`, { method: 'DELETE' })
}
