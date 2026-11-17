import { expect, test } from '@playwright/test'
import {
  adminRow,
  categoryEditor,
  chooseCategory,
  openAdminPage,
  openLibrary,
  showMostRows,
  signIn,
} from '../support/admin'
import { addDocuments, resetArchive } from '../support/database'
import { TEST_PASSWORD } from '../support/environment'

// Scenarios: features/admin/sprava.feature
test.describe('Správa archivu', () => {
  test.beforeEach(resetArchive)

  test('Bez přihlášení správa ukazuje jen přihlašovací formulář', async ({ page }) => {
    await page.goto('/sprava/skilly')
    await expect(page.getByLabel('Heslo')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nahrát', exact: true })).toHaveCount(0)
  })

  test('Nesprávné heslo má srozumitelnou zprávu', async ({ page }) => {
    await page.goto('/sprava')
    await page.getByLabel('Heslo').fill('spatne-heslo')
    await page.getByRole('button', { name: 'Přihlásit' }).click()
    await expect(page.getByRole('alert')).toHaveText('Heslo není správné. Zkuste to znovu.')
  })

  test('Opakované chybné pokusy se omezí', async ({ page }) => {
    await page.goto('/sprava')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.getByLabel('Heslo').fill(`spatne-${attempt}`)
      await page.getByRole('button', { name: 'Přihlásit' }).click()
      // The server has answered once the form is ready for the next attempt.
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByLabel('Heslo')).toHaveValue('')
      await expect(page.getByRole('button', { name: 'Přihlásit' })).toBeEnabled()
    }
    await expect(page.getByRole('alert')).toContainText('Příliš mnoho chybných pokusů')

    await page.getByLabel('Heslo').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Přihlásit' }).click()
    await expect(page.getByRole('alert')).toContainText('Příliš mnoho chybných pokusů')
    await expect(page.getByRole('table')).toHaveCount(0)
  })

  test('Správce vidí stavy všech dokumentů', async ({ page }) => {
    await signIn(page)
    await showMostRows(page)
    await expect(adminRow(page, 'Zpravodaj 3/2025')).toContainText('Zpracovává se')
    await expect(adminRow(page, 'smlouva-svoz-odpadu-2024')).toContainText('Čeká na zpracování')
    const failed = adminRow(page, 'Kronika obce, rok 1952')
    await expect(failed).toContainText('Chyba')
    await expect(failed).toContainText('Strany 4 až 9 jsou poškozené')
    await expect(adminRow(page, 'Kostel od polní cesty')).toContainText('Bez čitelného textu')
  })

  test('Změna metadat se projeví v knihovně', async ({ page }) => {
    await signIn(page)
    await showMostRows(page)
    await page.getByRole('button', { name: 'Upravit: Smlouva o nájmu společenského sálu' }).click()
    const dialog = page.getByRole('dialog', { name: 'Upravit dokument' })
    await dialog.getByLabel('Zobrazovaný název').fill('Nájem sálu, vzorová smlouva')
    await dialog.getByLabel('Rok vydání').fill('2024')
    await dialog.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText('Změny jsou uložené.')).toBeVisible()

    await openLibrary(page)
    await page.getByLabel('Rok vydání').selectOption('2024')
    await expect(page.locator('.document-link')).toHaveText(['Nájem sálu, vzorová smlouva'])
  })

  test('Odstranění vyžaduje potvrzení a dokument zmizí z knihovny', async ({ page }) => {
    await signIn(page)
    await showMostRows(page)
    await page.getByRole('button', { name: 'Odstranit: Hodový průvod' }).click()
    const dialog = page.getByRole('dialog', { name: 'Odstranit dokument?' })
    await expect(dialog).toContainText('Dokument „Hodový průvod“ zmizí z knihovny i z hledání')
    await dialog.getByRole('button', { name: 'Odstranit dokument' }).click()
    await expect(adminRow(page, 'Hodový průvod')).toHaveCount(0)

    await openLibrary(page)
    await expect(page.getByText('11 dokumentů')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Hodový průvod' })).toHaveCount(0)
  })

  test('Odstranění kategorie přesune dokumenty do Nezařazené', async ({ page }) => {
    await signIn(page)
    await openAdminPage(page, 'Kategorie')
    await chooseCategory(page, 'Fotografie')
    await categoryEditor(page)
      .getByRole('button', { name: 'Odstranit kategorii: Fotografie' })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Odstranit kategorii?' })
    await expect(dialog).toContainText('se přesunou do kategorie „Nezařazené“')
    await dialog.getByRole('button', { name: 'Odstranit kategorii' }).click()

    await page.getByRole('link', { name: 'Zpracování' }).click()
    await showMostRows(page)
    await expect(adminRow(page, 'Kostel od polní cesty')).toContainText('Nezařazené')
  })

  test('Bez přihlášení server odmítne správcovské operace i nezveřejněný soubor', async ({
    page,
    request,
  }) => {
    // The stored original of an unpublished document is not served to a visitor.
    expect((await request.get('/soubor/zpravodaj-2025-3')).status()).toBe(404)
    expect((await request.get('/soubor/rozpocet-2025-schvaleny')).status()).toBe(200)
    // An upload without a session is refused before anything is written.
    const upload = await request.put('/api/upload/00000000-0000-4000-8000-000000000000', {
      data: Buffer.from('%PDF-1.7'),
    })
    expect(upload.status()).toBe(401)

    await page.goto('/')
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    await expect(page.getByText('Zpravodaj 3/2025')).toHaveCount(0)
  })

  test('Odhlášení ukončí správcovskou relaci', async ({ page }) => {
    await signIn(page)
    await page.locator('.account summary').click()
    await page.getByRole('button', { name: 'Odhlásit' }).click()
    await expect(page.getByLabel('Heslo')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)

    // The session is gone on the server too, not only on this screen.
    await page.reload()
    await expect(page.getByLabel('Heslo')).toBeVisible()
  })

  test('Správce si obrázek zobrazí na místě seznamu', async ({ page, context }) => {
    await signIn(page)
    await showMostRows(page)
    await page.getByRole('button', { name: 'Zobrazit: Kostel od polní cesty' }).click()
    // The same viewer as in the library: it takes the place of the list, it is not a window over it.
    const viewer = page.getByRole('region', { name: 'Kostel od polní cesty' })
    await expect(viewer.getByRole('img', { name: 'Kostel od polní cesty' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.admin-table')).toBeHidden()
    expect(context.pages()).toHaveLength(1)
    // The debug panel next to it is about the same document.
    await expect(page.getByRole('complementary', { name: 'Ladění zpracování' })).toContainText(
      'Kostel od polní cesty',
    )

    await viewer.getByRole('button', { name: 'Zpět na seznam' }).click()
    await expect(viewer).toHaveCount(0)
    await expect(adminRow(page, 'Kostel od polní cesty')).toBeVisible()
  })

  test('Správce si PDF prohlédne na místě seznamu a může ho stáhnout', async ({
    page,
    context,
  }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Zobrazit: Zpravodaj 4/2025' }).click()
    const viewer = page.getByRole('region', { name: 'Zpravodaj 4/2025' })
    await expect(viewer.getByText('z 4')).toBeVisible()
    await expect(viewer.locator('canvas').first()).toBeVisible()
    expect(context.pages()).toHaveLength(1)

    const downloadPromise = page.waitForEvent('download')
    await viewer.getByRole('link', { name: 'Stáhnout' }).click()
    expect((await downloadPromise).suggestedFilename()).toBe('zpravodaj-2025-4.pdf')

    await viewer.getByRole('button', { name: 'Zpět na seznam' }).click()
    await expect(viewer).toHaveCount(0)
    await expect(adminRow(page, 'Zpravodaj 4/2025')).toBeVisible()
  })

  test('Přehled dokumentů se dělí na stránky a umí hledat', async ({ page }) => {
    await addDocuments(30)
    await signIn(page)
    const rows = page.locator('.admin-table tbody tr')
    await expect(page.getByText('1–10 z 45 dokumentů')).toBeVisible()
    await expect(rows).toHaveCount(10)

    const pager = page.getByRole('navigation', { name: 'Stránky seznamu' })
    await pager.getByRole('button', { name: 'Další' }).click()
    await expect(page.getByText('11–20 z 45 dokumentů')).toBeVisible()

    await page.getByLabel('Řádků na stránku:').selectOption('50')
    await expect(rows).toHaveCount(45)
    await expect(adminRow(page, 'Vyhláška č. 30')).toBeVisible()

    // A click on a column head orders the list.
    await page.getByRole('button', { name: 'Seřadit podle sloupce Dokument' }).click()
    await expect(rows.first()).toContainText('Cyklostezka k nádraží, studie první etapy')
    await page.getByRole('button', { name: 'Seřadit podle sloupce Přidáno' }).click()

    // The status filter and the search both start again from the first page.
    await page.getByLabel('Stav').selectOption({ label: 'Chyba' })
    await expect(rows).toHaveCount(1)
    await expect(adminRow(page, 'Kronika obce, rok 1952')).toBeVisible()
    await page.getByLabel('Stav').selectOption({ label: 'Všechny stavy' })

    await page.getByRole('searchbox', { name: 'Hledat v dokumentech' }).fill('osvetleni')
    await expect(rows).toHaveCount(1)
    await expect(adminRow(page, 'Zápis z 9. zasedání zastupitelstva')).toBeVisible()
  })

  test('Přehled má stejné nástroje jako knihovna: kategorie, stav a rok', async ({ page }) => {
    await signIn(page)
    await showMostRows(page)
    const pill = (name: string) => page.locator('.pills__line').getByRole('button', { name })
    await expect(pill('Všechny')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('radio', { name: 'Náhled' })).toHaveCount(0)

    await pill('Smlouvy').click()
    await expect(adminRow(page, 'Smlouva o nájmu společenského sálu')).toHaveCount(1)
    await expect(adminRow(page, 'Návrh rozpočtu')).toHaveCount(0)
    await pill('Rozpočty').click()
    await expect(adminRow(page, 'Návrh rozpočtu na rok 2026')).toHaveCount(1)
    await expect(adminRow(page, 'Smlouva o nájmu společenského sálu')).toHaveCount(0)

    await page.getByLabel('Rok vydání').selectOption('2026')
    await expect(adminRow(page, 'Návrh rozpočtu na rok 2026')).toHaveCount(1)
    await expect(adminRow(page, 'Smlouva o nájmu společenského sálu')).toHaveCount(0)
  })

  test('Hlavička vede správce k nahrávání, zpracování a správě', async ({ page }) => {
    await signIn(page)
    const menu = page.getByRole('navigation', { name: 'Hlavní nabídka' })
    await expect(page.locator('.account')).toContainText('Správce')

    await menu.getByRole('link', { name: 'Dokumenty', exact: true }).click()
    await expect(
      page.locator('.pills__line').getByRole('button', { name: 'Všechny' }),
    ).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Zpracování' })).toBeVisible()

    // Uploading and processing are one place: the list, with the button "Nahrát".
    await menu.getByRole('link', { name: 'Zpracování' }).click()
    await expect(page).toHaveURL(/\/sprava$/)
    await expect(page.getByRole('button', { name: 'Nahrát', exact: true })).toBeVisible()

    await menu.getByText('Správa').click()
    await expect(menu.getByRole('link')).toHaveText([
      'Dokumenty',
      'Zpracování',
      'Kategorie',
      'Skilly',
      'Náklady',
      'Ladění chatu',
    ])
    await menu.getByRole('link', { name: 'Náklady' }).click()
    await expect(page.getByRole('heading', { name: 'Náklady', level: 1 })).toBeVisible()
  })
})
