import { expect, test, type Page } from '@playwright/test'
import {
  categoryEditor,
  chooseCategory,
  openAdminPage,
  openLibrary,
  signIn,
} from '../support/admin'
import { resetArchive } from '../support/database'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Seznam kategorií' })
const row = (page: Page, name: string) =>
  nav(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
const grip = (page: Page, name: string) =>
  page.getByRole('button', { name: `Změnit pořadí: ${name}` })

/** Names of the categories in the order the list shows them. */
const names = (page: Page) => nav(page).locator('li strong').allTextContents()

const DEFAULT_ORDER = [
  'Rozpočty',
  'Smlouvy',
  'Plány a projekty',
  'Zpravodaje',
  'Zápisy',
  'Fotografie',
  'Nezařazené',
]

async function open(page: Page) {
  await signIn(page)
  await openAdminPage(page, 'Kategorie')
  await expect(nav(page).getByRole('listitem')).toHaveCount(DEFAULT_ORDER.length)
}

// Scenarios: features/admin/kategorie.feature
test.describe('Kategorie', () => {
  test.beforeEach(resetArchive)

  test('Pořadí kategorií se mění přetažením řádku', async ({ page }) => {
    await open(page)
    expect(await names(page)).toEqual(DEFAULT_ORDER)

    // The upper half of a row means "before it".
    await grip(page, 'Fotografie').dragTo(row(page, 'Rozpočty'), {
      targetPosition: { x: 200, y: 4 },
    })
    const expected = ['Fotografie', ...DEFAULT_ORDER.filter((name) => name !== 'Fotografie')]
    await expect.poll(() => names(page)).toEqual(expected)

    await page.reload()
    await expect.poll(() => names(page)).toEqual(expected)

    await page.setViewportSize({ width: 1900, height: 900 })
    await openLibrary(page)
    const tabs = await page.locator('.pills__line button').allTextContents()
    expect(tabs.map((tab) => tab.replace(/\d+$/, '').trim()).slice(1)).toEqual(expected)
  })

  test('Řádek jde posunout šipkami, i když není po ruce myš', async ({ page }) => {
    await open(page)
    await grip(page, 'Zápisy').focus()
    await page.keyboard.press('ArrowUp')

    const expected = [...DEFAULT_ORDER]
    expected.splice(3, 0, ...expected.splice(4, 1))
    await expect.poll(() => names(page)).toEqual(expected)
    // The row moved in the page, and the focus went with it.
    await expect(grip(page, 'Zápisy')).toBeFocused()
    await expect(page.getByRole('status').filter({ hasText: 'je na místě' })).toHaveText(
      'Kategorie „Zápisy“ je na místě 4 z 6.',
    )

    await page.keyboard.press('ArrowDown')
    await expect.poll(() => names(page)).toEqual(DEFAULT_ORDER)
  })

  test('Nezařazené zůstává poslední a nejde odstranit', async ({ page }) => {
    await open(page)
    await expect(grip(page, 'Nezařazené')).toHaveCount(0)
    await expect(grip(page, 'Zápisy')).toHaveCount(1)

    await chooseCategory(page, 'Nezařazené')
    await expect(categoryEditor(page)).toContainText('Tuto kategorii nejde odstranit.')
    await expect(categoryEditor(page).getByRole('button', { name: /Odstranit/ })).toHaveCount(0)
  })

  test('Změna názvu, popisu a barvy se uloží až tlačítkem', async ({ page }) => {
    await open(page)
    await chooseCategory(page, 'Smlouvy')
    const editor = categoryEditor(page)
    const save = editor.getByRole('button', { name: 'Uložit změny' })
    await expect(save).toBeDisabled()

    await editor.getByRole('textbox', { name: 'Název' }).fill('Smlouvy a dohody')
    await editor.getByRole('textbox', { name: 'Popis' }).fill('Smlouvy a dohody obce.')
    await editor.getByRole('radio', { name: 'Fialová' }).check({ force: true })

    await expect(editor).toContainText('Neuložené změny')
    // Nothing is stored yet, so the list still shows what it showed.
    expect(await names(page)).toEqual(DEFAULT_ORDER)

    await save.click()
    await expect(page.getByText('Kategorie „Smlouvy a dohody“ je uložená.')).toBeVisible()
    await expect(row(page, 'Smlouvy a dohody')).toContainText('Smlouvy a dohody obce.')
    await expect(row(page, 'Smlouvy a dohody').locator('.category-nav__tab')).toHaveCSS(
      'background-color',
      'rgb(90, 79, 176)',
    )

    await page.reload()
    await chooseCategory(page, 'Smlouvy a dohody')
    await expect(editor.getByRole('textbox', { name: 'Popis' })).toHaveValue(
      'Smlouvy a dohody obce.',
    )
    await expect(editor.getByRole('radio', { name: 'Fialová' })).toBeChecked()
  })

  test('Zrušit zahodí neuložené změny', async ({ page }) => {
    await open(page)
    await chooseCategory(page, 'Smlouvy')
    const editor = categoryEditor(page)
    const name = editor.getByRole('textbox', { name: 'Název' })
    await name.fill('Něco jiného')
    await expect(editor).toContainText('Neuložené změny')

    await editor.getByRole('button', { name: 'Zrušit' }).click()
    await expect(name).toHaveValue('Smlouvy')
    await expect(editor).not.toContainText('Neuložené změny')
    await expect(editor.getByRole('button', { name: 'Uložit změny' })).toBeDisabled()
  })

  test('Nová kategorie se přidá z okna a zařadí se před Nezařazené', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Přidat kategorii' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nová kategorie' })
    const create = dialog.getByRole('button', { name: 'Přidat kategorii' })
    // A category without a name is not added.
    await expect(create).toBeDisabled()

    await dialog.getByRole('textbox', { name: 'Název' }).fill('Vyhlášky')
    await dialog.getByRole('textbox', { name: 'Popis' }).fill('Obecně závazné vyhlášky obce.')
    await dialog.getByRole('radio', { name: 'Zelená' }).check({ force: true })
    await create.click()
    await expect(dialog).toHaveCount(0)

    await expect
      .poll(() => names(page))
      .toEqual([...DEFAULT_ORDER.slice(0, -1), 'Vyhlášky', 'Nezařazené'])
    // The new category is the one that is open.
    await expect(categoryEditor(page).getByRole('textbox', { name: 'Název' })).toHaveValue(
      'Vyhlášky',
    )
    await expect(categoryEditor(page)).toContainText('0 dokumentů')
  })
})
