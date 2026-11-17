import { expect, test } from '@playwright/test'
import { resetArchive } from '../support/database'

// Scenarios: features/public/prohlizec.feature
test.describe('Integrovaný prohlížeč dokumentů', () => {
  test.beforeEach(resetArchive)

  test('PDF lze stránkovat a zvětšovat', async ({ page, context }) => {
    await page.goto('/')
    await page.locator('.document-link', { hasText: 'Schválený rozpočet na rok 2025' }).click()

    await expect(
      page.getByRole('heading', { name: 'Schválený rozpočet na rok 2025' }),
    ).toBeVisible()
    await expect(page.getByText('z 3')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Strana', exact: true })).toHaveValue('1')
    // The document opens inside the application, not in a new tab.
    expect(context.pages()).toHaveLength(1)

    await page.getByRole('button', { name: 'Další strana' }).click()
    await expect(page.getByRole('textbox', { name: 'Strana', exact: true })).toHaveValue('2')

    const zoom = page.locator('.zoom-value')
    const before = await zoom.textContent()
    await page.getByRole('button', { name: 'Přiblížit' }).click()
    await expect(zoom).not.toHaveText(before ?? '')

    await expect(page.getByRole('link', { name: 'Stáhnout' })).toHaveAttribute(
      'download',
      'rozpocet-2025-schvaleny.pdf',
    )
  })

  test('Adresa s číslem strany otevře tuto stranu', async ({ page }) => {
    await page.goto('/?doc=rozpocet-2025-schvaleny&strana=3')
    await expect(page.getByRole('textbox', { name: 'Strana', exact: true })).toHaveValue('3')
    await expect(page.getByRole('img', { name: 'Strana 3' })).toBeInViewport()
  })

  test('Návrat ze zobrazení obnoví hledání, filtry a režim', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('searchbox').fill('smlouva')
    await page.getByRole('radio', { name: 'Náhled' }).click()
    await page.locator('.document-link', { hasText: 'Smlouva o nájmu společenského sálu' }).click()
    await expect(page.getByRole('button', { name: 'Zpět na seznam' })).toBeVisible()

    await page.getByRole('button', { name: 'Zpět na seznam' }).click()
    await expect(page.getByRole('searchbox')).toHaveValue('smlouva')
    await expect(page.getByRole('radio', { name: 'Náhled' })).toBeChecked()
    await expect(page.locator('.preview-card')).toHaveCount(2)
  })

  test('Obrázek lze zvětšit a přizpůsobit oknu', async ({ page }) => {
    await page.goto('/?doc=plan-navsi-1936')
    const image = page.getByRole('img', { name: 'Plán návsi a přilehlých pozemků' })
    await expect(image).toBeVisible()
    const fitted = await image.boundingBox()

    await page.getByRole('button', { name: 'Přiblížit' }).click()
    await expect(page.locator('.zoom-value')).toContainText('%')
    await expect
      .poll(async () => (await image.boundingBox())?.width ?? 0)
      .toBeGreaterThan(fitted?.width ?? 0)

    await page.getByRole('button', { name: 'Přizpůsobit oknu' }).click()
    await expect(page.getByRole('button', { name: 'Přizpůsobit oknu' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(image).toBeInViewport({ ratio: 1 })
  })

  test('Zvětšení na celou plochu a návrat', async ({ page }) => {
    await page.goto('/?doc=zpravodaj-2025-4')
    const viewer = page.getByRole('region', { name: 'Zpravodaj 4/2025' })
    await page.getByRole('button', { name: 'Zvětšit' }).click()
    await expect(viewer).toHaveClass(/viewer--expanded/)
    await expect(page.getByRole('button', { name: 'Zmenšit' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(viewer).not.toHaveClass(/viewer--expanded/)
  })

  test('Nezveřejněný nebo odstraněný dokument', async ({ page }) => {
    // `zpravodaj-2025-3` exists but is still being processed.
    await page.goto('/?doc=zpravodaj-2025-3')
    await expect(
      page.getByRole('heading', { name: 'Dokument není dostupný', level: 1 }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Stáhnout' })).toHaveCount(0)
    await expect(page.locator('.pdf-page')).toHaveCount(0)
  })

  test('Obrázek se otevře přes stránku, ne v nové kartě', async ({ page, context }) => {
    // The plan is among the oldest documents, so the page has to hold them all.
    await page.goto('/?pocet=50')
    const title = 'Plán návsi a přilehlých pozemků'
    const overlay = page.getByRole('dialog', { name: title })

    await page.locator('.document-link', { hasText: title }).click()
    await expect(overlay.getByRole('img', { name: title })).toBeVisible()
    await expect(page).toHaveURL(/doc=plan-navsi-1936/)
    expect(context.pages()).toHaveLength(1)
    // The list was not replaced: it is still on the page under the window.
    await expect(page.locator('.doc-list')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
    await expect(page).not.toHaveURL(/doc=/)
    await expect(page.getByRole('searchbox')).toBeVisible()

    await page.locator('.document-link', { hasText: title }).click()
    await overlay.getByRole('button', { name: 'Zavřít' }).click()
    await expect(overlay).toHaveCount(0)
  })
})
