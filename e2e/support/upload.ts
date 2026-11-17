import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { adminRow } from './admin'

export interface TestFile {
  name: string
  mimeType: string
  buffer: Buffer
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
}

/**
 * A demonstration file under a new name and with a few extra bytes at its end.
 * The archive refuses content it already holds, and the seeded documents are
 * made from these same files, so an upload needs content of its own.
 */
export function demoFile(source: string, name: string): TestFile {
  const buffer = Buffer.concat([readFileSync(`public/demo/${source}`), randomBytes(8)])
  return { name, mimeType: MIME_TYPES[name.split('.').pop() ?? ''] ?? 'image/jpeg', buffer }
}

export const uploadWindow = (page: Page) => page.getByRole('dialog', { name: 'Nahrát dokumenty' })
export const batchItem = (page: Page, name: string) =>
  uploadWindow(page).locator('.batch-item').filter({ hasText: name })

/** Opens the upload window from the list of documents. The administrator must be signed in. */
export async function openUploadWindow(page: Page) {
  await page.getByRole('link', { name: 'Zpracování' }).click()
  await page.getByRole('button', { name: 'Nahrát', exact: true }).click()
  await expect(uploadWindow(page).getByText('Přetáhněte sem soubory nebo')).toBeVisible()
}

export async function chooseFiles(page: Page, files: TestFile | TestFile[] | string) {
  await uploadWindow(page).locator('input[type="file"]').setInputFiles(files)
}

const saveLabel = (count: number) =>
  `Uložit ${count} ${count === 1 ? 'soubor' : count < 5 ? 'soubory' : 'souborů'}`

/**
 * Stores files through the upload window and waits until the list of documents
 * shows each of them with the outcome of processing.
 */
export async function uploadFiles(
  page: Page,
  files: TestFile[],
  outcome: 'Připraveno' | 'Chyba' = 'Připraveno',
) {
  await openUploadWindow(page)
  await chooseFiles(page, files)
  await uploadWindow(page)
    .getByRole('button', { name: saveLabel(files.length) })
    .click()
  // The window closes by itself once every file is stored.
  await expect(uploadWindow(page)).toHaveCount(0)
  for (const file of files) await expect(adminRow(page, file.name)).toContainText(outcome)
}

export async function uploadDemoFile(
  page: Page,
  source: string,
  name: string,
  outcome: 'Připraveno' | 'Chyba' = 'Připraveno',
) {
  await uploadFiles(page, [demoFile(source, name)], outcome)
}
