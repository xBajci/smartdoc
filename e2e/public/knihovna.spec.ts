import { expect, test } from '@playwright/test'
import { addDocuments, resetArchive } from '../support/database'
import { TEST_PASSWORD } from '../support/environment'

// Scenarios: features/public/knihovna.feature
test.describe('Veřejná knihovna dokumentů', () => {
  test.beforeEach(resetArchive)

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  const documentLinks = (page: import('@playwright/test').Page) => page.locator('.document-link')

  test('Seznam ukazuje jen zveřejněné dokumenty', async ({ page }) => {
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    // The list is not a table: it is grouped by the date of the documents, here by their year.
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.locator('.doc-group').first()).toContainText('2026')
    await expect(page.locator('.doc-row').first().locator('.doc-row__category')).not.toBeEmpty()
    await expect(page.getByText('Zpravodaj 3/2025')).toHaveCount(0)
    // No large page headings; a visitor has one item in the main menu.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0)
    await expect(
      page.getByRole('navigation', { name: 'Hlavní nabídka' }).getByRole('link'),
    ).toHaveText(['Dokumenty'])
  })

  test('Hledání podle názvu nerozlišuje diakritiku', async ({ page }) => {
    await page.getByRole('searchbox').fill('schvaleny 2025')
    await expect(documentLinks(page)).toHaveText(['Schválený rozpočet na rok 2025'])
    await expect(page.locator('.document-link mark')).toHaveText(['Schválený', '2025'])
  })

  test('Hledání podle popisu', async ({ page }) => {
    await page.getByRole('searchbox').fill('cisterna')
    await expect(documentLinks(page)).toHaveText(['Zápis ze schůze zastupitelstva, září 1998'])
  })

  test('Hledání se kombinuje s kategorií a rokem', async ({ page }) => {
    await page.getByRole('searchbox').fill('rozpočet')
    await page.locator('.pills__line').getByRole('button', { name: 'Rozpočty' }).click()
    await page.getByLabel('Rok vydání').selectOption('2026')
    await expect(documentLinks(page)).toHaveText(['Návrh rozpočtu na rok 2026'])
    await expect(
      page.locator('.pills__line').getByRole('button', { name: 'Rozpočty' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Rok vydání')).toHaveValue('2026')
    // Each category says how many documents it would list under the search and the year.
    await expect(
      page.locator('.pills__line').getByRole('button', { name: 'Rozpočty' }),
    ).toContainText('1')
  })

  test('Hledání bez výsledků nabídne zrušení filtrů', async ({ page }) => {
    await page.getByRole('searchbox').fill('kanalizace')
    await expect(
      page.getByRole('heading', { name: 'Tomuto hledání neodpovídá žádný dokument' }),
    ).toBeVisible()
    await page.getByRole('status').getByRole('button', { name: 'Zrušit všechny filtry' }).click()
    await expect(page.getByText('12 dokumentů')).toBeVisible()
  })

  test('Oba způsoby zobrazení zachovají hledání', async ({ page }) => {
    await page.getByRole('searchbox').fill('zápis')
    await expect(page.locator('.doc-row')).toHaveCount(2)
    // The grid of tiles is gone: only the list and the previews are left.
    await expect(page.getByRole('radio')).toHaveCount(2)
    await page.getByRole('radio', { name: 'Náhled' }).click()
    await expect(page.locator('.preview-card')).toHaveCount(2)
    await expect(page.getByRole('searchbox')).toHaveValue('zápis')
    await expect(page.getByRole('radio', { name: 'Náhled' })).toBeChecked()
  })

  test('Filtr podle neznámého roku', async ({ page }) => {
    await page.getByLabel('Rok vydání').selectOption({ label: 'Neznámý rok' })
    await expect(documentLinks(page).filter({ hasText: 'Kostel od polní cesty' })).toHaveCount(1)
    await expect(documentLinks(page).filter({ hasText: 'Návrh rozpočtu' })).toHaveCount(0)
    await expect(page.getByLabel('Rok vydání')).toHaveValue('neznamy')
  })

  test('Nástroje: hledání, zobrazení, kategorie jako štítky, rok a řazení', async ({ page }) => {
    await expect(page.locator('.lib__selects select')).toHaveCount(2)
    for (const view of ['Seznam', 'Náhled']) {
      await expect(page.getByRole('radio', { name: view })).toBeVisible()
    }
    const all = page.locator('.pills__line').getByRole('button', { name: 'Všechny' })
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await expect(all).toContainText('12')

    // A category that fits in the line is a pill of its own.
    await page.locator('.pills__line').getByRole('button', { name: 'Smlouvy' }).click()
    await expect(
      documentLinks(page).filter({ hasText: 'Smlouva o nájmu společenského sálu' }),
    ).toHaveCount(1)
    await expect(documentLinks(page).filter({ hasText: 'Návrh rozpočtu' })).toHaveCount(0)
    await expect(
      page.locator('.pills__line').getByRole('button', { name: 'Smlouvy' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await all.click()
    await expect(page.getByText('12 dokumentů')).toBeVisible()
  })

  test('Kategorie, které se nevejdou, jsou v nabídce na konci řádku', async ({ page }) => {
    const tabs = page.locator('.pills__line button')
    const more = page.locator('.pills__more')
    await page.setViewportSize({ width: 1900, height: 900 })
    await expect(more).toHaveCount(0)
    const all = await tabs.count()

    await page.setViewportSize({ width: 1000, height: 900 })
    await expect(more).toBeVisible()
    await expect.poll(() => tabs.count()).toBeLessThan(all)
    // The line does not run under the selects or out of the page.
    const line = await page.locator('.pills').boundingBox()
    const button = await more.boundingBox()
    expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(
      (line?.x ?? 0) + (line?.width ?? 0) + 1,
    )

    const summary = more.locator('summary')
    await summary.click()
    await more.getByRole('button', { name: /Fotografie/ }).click()
    await expect(page).toHaveURL(/kategorie=/)
    await expect(documentLinks(page).filter({ hasText: 'Kostel od polní cesty' })).toHaveCount(1)
    await expect(documentLinks(page).filter({ hasText: 'Návrh rozpočtu' })).toHaveCount(0)
    // A choice closes the menu. The button keeps its name and its place; it only shows that the choice is inside.
    await expect(more).not.toHaveAttribute('open')
    await expect(summary).toContainText('Další')
    await expect(summary.locator('.cat-pill')).toHaveAttribute('data-chosen', 'true')
    await expect(more).toBeVisible()
  })

  test('Vybraná je vždy jen jedna kategorie', async ({ page }) => {
    const pill = (name: string) => page.locator('.pills__line').getByRole('button', { name })
    const contract = documentLinks(page).filter({ hasText: 'Smlouva o nájmu společenského sálu' })
    const budget = documentLinks(page).filter({ hasText: 'Návrh rozpočtu' })

    await pill('Smlouvy').click()
    await expect(pill('Smlouvy')).toHaveAttribute('aria-pressed', 'true')
    await expect(pill('Všechny')).toHaveAttribute('aria-pressed', 'false')
    await expect(contract).toHaveCount(1)
    await expect(budget).toHaveCount(0)

    // Another category takes the place of the chosen one.
    await pill('Rozpočty').click()
    await expect(pill('Rozpočty')).toHaveAttribute('aria-pressed', 'true')
    await expect(pill('Smlouvy')).toHaveAttribute('aria-pressed', 'false')
    await expect(contract).toHaveCount(0)
    await expect(budget).toHaveCount(1)

    // The choice is in the address, so a loaded page has it again.
    await page.reload()
    await expect(pill('Rozpočty')).toHaveAttribute('aria-pressed', 'true')
    await expect(pill('Smlouvy')).toHaveAttribute('aria-pressed', 'false')

    // A second click changes nothing; only "Všechny" takes the choice away.
    await pill('Rozpočty').click()
    await expect(pill('Rozpočty')).toHaveAttribute('aria-pressed', 'true')
    await expect(budget).toHaveCount(1)
    await pill('Všechny').click()
    await expect(page).not.toHaveURL(/kategorie=/)
    await expect(page.getByText('12 dokumentů')).toBeVisible()
  })

  test('Řádek otevře dokument kliknutím a má dvě akce jako ikony', async ({ page }) => {
    const row = page.locator('.doc-row').filter({ hasText: 'Návrh rozpočtu na rok 2026' })
    const actions = row.locator('.row-actions')
    await row.hover()
    await expect(actions.locator('[data-tip]')).toHaveCount(2)
    await expect(actions.getByRole('link', { name: /Stáhnout/ })).toHaveAttribute(
      'href',
      /\/soubor\/.+\?stahnout/,
    )
    // The label of an icon shows on hover.
    const ask = actions.getByRole('button', { name: /Zeptat se na dokument/ })
    await expect(ask).toHaveAttribute('data-tip', 'Zeptat se na dokument')
    await ask.click()
    await expect(page).not.toHaveURL(/doc=/)
    await expect(actions.getByRole('button', { name: /Vybráno pro otázku/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // A click anywhere in the row opens the document; there is no icon for it.
    await row.click({ position: { x: 30, y: 30 } })
    await expect(page).toHaveURL(/doc=/)
  })

  test('Hlavička ukazuje návštěvníkovi jen dokumenty a přihlášení', async ({ page }) => {
    const account = page.locator('.account')
    await expect(account).toContainText('Návštěvník')
    await account.locator('summary').click()
    await account.getByRole('link', { name: 'Přihlásit se' }).click()
    // The form does not say where it leads; the role decides what shows after it.
    await expect(page).toHaveURL(/\/prihlaseni$/)
    await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
    await expect(page.getByText(/správ/i)).toHaveCount(0)
    await page.getByLabel('Heslo').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Přihlásit' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('.account')).toContainText('Správce')
    await expect(
      page
        .getByRole('navigation', { name: 'Hlavní nabídka' })
        .getByRole('link', { name: 'Zpracování' }),
    ).toBeVisible()
  })

  test('Seznam se řadí výběrem řazení', async ({ page }) => {
    const first = page.locator('.doc-row').first()
    const order = page.getByLabel('Řazení')
    await expect(first).toContainText('Zápis z 9. zasedání zastupitelstva')
    await expect(page.locator('.doc-group').first()).toBeVisible()

    await order.selectOption('nazev')
    await expect(first).toContainText('Cyklostezka k nádraží, studie první etapy')
    // Days group a list only when it is ordered by date.
    await expect(page.locator('.doc-group')).toHaveCount(0)
    await order.selectOption('nazev-z')
    await expect(first).toContainText('Zpravodaj 4/2025')
    await expect(page).toHaveURL(/razeni=nazev-z/)

    // By the date of the document: the oldest is the plan from 1936.
    await order.selectOption('vydane-z')
    await expect(first).toContainText('Plán návsi a přilehlých pozemků')
    await expect(page.locator('.doc-group').first()).toContainText('1936')
    // By the day of adding the list reads as days.
    await order.selectOption('nove')
    await expect(first).toContainText('Zápis z 9. zasedání zastupitelstva')
    await expect(page.locator('.doc-group').first()).toContainText('4. listopadu 2026')
    await expect(page).toHaveURL(/razeni=nove/)

    await order.selectOption('vydane')
    await expect(page).not.toHaveURL(/razeni=/)

    // A document without a date comes last, under a heading of its own.
    await page.goto('/?razeni=vydane-z&pocet=50')
    await expect(page.locator('.doc-group').last()).toContainText('Bez data')
  })

  test('Hledání prochází i text dokumentu a ukáže nalezené místo', async ({ page }) => {
    await page.getByRole('searchbox').fill('verejne osvetleni')
    await expect(documentLinks(page)).toHaveText(['Zápis z 9. zasedání zastupitelstva'])
    const snippet = page.locator('.document-snippet')
    await expect(snippet).toContainText('V textu:')
    await expect(snippet).toContainText('výměnu veřejného osvětlení v ulici Zahradní')
    await expect(snippet.locator('mark')).toHaveText(['veřejné', 'osvětlení'])
  })

  test('Hledání najde slovo podle jeho začátku a řadí podle shody', async ({ page }) => {
    await page.getByRole('searchbox').fill('cyklost')
    // The name weighs more than the content, so the study comes before the minutes.
    await expect(documentLinks(page)).toHaveText([
      'Cyklostezka k nádraží, studie první etapy',
      'Zápis z 9. zasedání zastupitelstva',
    ])
    await expect(page.getByLabel('Řazení')).toHaveValue('shoda')
    await expect(page).toHaveURL(/q=cyklost/)
    await expect(page).not.toHaveURL(/razeni=/)
  })

  test('Dlouhý seznam ukáže první dokumenty a další přidá sám při posunu', async ({ page }) => {
    await addDocuments(30)
    await page.reload()
    await expect(page.getByText('Zobrazeno 10 z 42 dokumentů')).toBeVisible()
    await expect(documentLinks(page)).toHaveCount(10)

    // The end of the list comes into view: the next documents load by themselves.
    await page.locator('.lib-card__foot').scrollIntoViewIfNeeded()
    await expect(page.getByText('Zobrazeno 20 z 42 dokumentů')).toBeVisible()
    await expect(documentLinks(page)).toHaveCount(20)
    await expect(page).toHaveURL(/pocet=20/)

    // The button is still there, for when the list does not grow by itself.
    await page.getByRole('button', { name: 'Zobrazit další' }).click()
    await expect(page.getByText('Zobrazeno 30 z 42 dokumentů')).toBeVisible()

    // A search starts again with the first documents.
    await page.getByRole('searchbox').fill('vyhláška')
    await expect(page.getByText('Zobrazeno 10 z 30 dokumentů')).toBeVisible()
    await expect(page).not.toHaveURL(/pocet=/)
  })

  test('Když jsou vidět všechny dokumenty, tlačítko „Zobrazit další“ zmizí', async ({ page }) => {
    await addDocuments(30)
    await page.goto('/?pocet=50&razeni=nove')
    await expect(page.getByText('Zobrazeno 42 z 42 dokumentů')).toBeVisible()
    await expect(documentLinks(page)).toHaveCount(42)
    await expect(documentLinks(page).last()).toHaveText('Vyhláška č. 30')
    await expect(page.getByRole('button', { name: 'Zobrazit další' })).toHaveCount(0)
  })
})
