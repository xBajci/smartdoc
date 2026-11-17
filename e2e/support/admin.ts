import { expect, type Page } from '@playwright/test'
import { TEST_PASSWORD } from './environment'

export async function signIn(page: Page) {
  await page.goto('/sprava')
  await page.getByLabel('Heslo').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Přihlásit' }).click()
  await expect(page.getByRole('heading', { name: 'Dokumenty', level: 1 })).toBeVisible()
}

/** Puts the most rows on one page, so a test finds its document whatever page it is on. */
export async function showMostRows(page: Page) {
  await page.getByLabel('Řádků na stránku:').selectOption('50')
}

/** Goes from the administration to the public library. */
export async function openLibrary(page: Page) {
  await page.getByRole('link', { name: 'Dokumenty', exact: true }).click()
  // The administration has a search field of its own, so the library's one is named.
  await expect(
    page.getByRole('searchbox', { name: 'Hledat v názvech, popisech a textu dokumentů' }),
  ).toBeVisible()
  // The library starts with the newest date of a document; a test looks for what it has just added.
  await page.getByLabel('Řazení').selectOption('nove')
}

/** Opens a page of the administration from the "Správa" menu of the header. */
export async function openAdminPage(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Hlavní nabídka' }).getByText('Správa').click()
  await page.getByRole('link', { name, exact: true }).click()
}

/** A row of a table in the administration; rows of the upload window are not counted. */
export function adminRow(page: Page, title: string) {
  return page.locator('tr:not(.batch-item)').filter({ hasText: title })
}

/** The editor of the open category on the page "Kategorie". */
export function categoryEditor(page: Page) {
  return page.getByRole('form', { name: 'Úprava kategorie' })
}

/** Opens a category of the list on the page "Kategorie" in the editor. */
export async function chooseCategory(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Seznam kategorií' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await expect(categoryEditor(page).getByRole('textbox', { name: 'Název' })).toHaveValue(name)
}
