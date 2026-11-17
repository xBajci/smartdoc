import { expect, test, type Page } from '@playwright/test'
import { adminRow, openAdminPage, signIn } from '../support/admin'
import { resetArchive } from '../support/database'
import { uploadDemoFile } from '../support/upload'

const openCosts = (page: Page) => openAdminPage(page, 'Náklady')

// Scenarios: features/admin/naklady.feature
// The test models cost $1/$2 (fake:test) and $2/$4 (fake:description) per million tokens,
// and every call uses 1000 tokens in and 100 out: $0.0012 and $0.0024.
test.describe('Náklady na zpracování', () => {
  test.beforeEach(resetArchive)

  test('Bez zpracování stránka říká, že není co ukázat', async ({ page }) => {
    await signIn(page)
    await openCosts(page)
    await expect(page.getByText('Zatím se nezpracoval žádný dokument.')).toBeVisible()
  })

  test('Náklady jsou rozdělené podle modelu a typu souboru', async ({ page }) => {
    await signIn(page)
    await uploadDemoFile(page, 'foto-kostel-leto.jpg', 'vez-z-jihu.jpg')
    await uploadDemoFile(page, 'zapis-zastupitelstvo-1998-sken.pdf', 'zapis-sken.pdf')
    // The debug panel says for each document what its processing cost.
    const debug = page.getByRole('complementary', { name: 'Ladění zpracování' })
    await adminRow(page, 'vez-z-jihu').click()
    await expect(debug.locator('.debug-facts').first()).toContainText('0,0022 $')
    await adminRow(page, 'zapis-sken.pdf').click()
    await expect(debug.locator('.debug-facts').first()).toContainText('0,0046 $')
    await openCosts(page)

    // Image: one call. Scanned PDF: one page read, one description. Each also gets a
    // category from the decision model and an embedding for the chat.
    const summary = page.locator('.cost-summary')
    await expect(summary).toContainText('0,0068 $')
    await expect(summary).toContainText('Zpracování2')

    const groups = page.getByRole('table').first().getByRole('row')
    await expect(
      groups.filter({ hasText: 'fake:test' }).filter({ hasText: 'Obrázek' }),
    ).toContainText(['1', '1', '1 000', '100', '0,0012 $'].join(''))
    await expect(groups.filter({ hasText: 'fake:test' }).filter({ hasText: 'PDF' })).toContainText(
      '0,0012 $',
    )
    await expect(groups.filter({ hasText: 'fake:description' })).toContainText('0,0024 $')

    const runs = page.getByRole('table').nth(1).getByRole('row')
    await expect(runs.filter({ hasText: 'vez-z-jihu' })).toContainText('0,0022 $')
    await expect(groups.filter({ hasText: 'fake:decision' })).toHaveCount(2)
    const scan = runs.filter({ hasText: 'zapis-sken' })
    await expect(scan).toContainText('fake:decision, fake:description, fake:embedding, fake:test')
    await expect(scan).toContainText('0,0046 $')
  })

  test('Náklady zůstanou i po odstranění dokumentu', async ({ page }) => {
    await signIn(page)
    await uploadDemoFile(page, 'foto-kostel-leto.jpg', 'vez-z-jihu.jpg')
    await page.getByRole('button', { name: 'Odstranit: vez-z-jihu' }).click()
    await page
      .getByRole('dialog', { name: 'Odstranit dokument?' })
      .getByRole('button', { name: 'Odstranit dokument' })
      .click()
    await expect(adminRow(page, 'vez-z-jihu')).toHaveCount(0)

    await openCosts(page)
    await expect(page.getByRole('row').filter({ hasText: 'vez-z-jihu' })).toContainText('0,0022 $')
  })

  test('Návštěvník náklady nedostane', async ({ page }) => {
    await page.goto('/sprava/naklady')
    await expect(page.getByLabel('Heslo')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
  })
})
