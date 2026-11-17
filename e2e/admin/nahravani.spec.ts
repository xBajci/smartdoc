import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { adminRow, openLibrary, showMostRows, signIn } from '../support/admin'
import { resetArchive } from '../support/database'
import {
  batchItem,
  chooseFiles,
  demoFile,
  openUploadWindow,
  uploadFiles,
  uploadWindow,
} from '../support/upload'

// Scenarios: features/admin/nahravani.feature
test.describe('Nahrávání dokumentů', () => {
  test.beforeEach(resetArchive)

  test('Nahrávání nemá vlastní stránku, je to okno nad přehledem', async ({ page }) => {
    await signIn(page)
    // The header has no item for uploading: the button of the list of processing opens the window.
    await expect(page.getByRole('link', { name: 'Nahrávání' })).toHaveCount(0)
    await openUploadWindow(page)

    const window = uploadWindow(page)
    await expect(window.getByText('Jeden soubor i více najednou · PDF, JPG, PNG')).toBeVisible()
    await expect(window.getByText('Jeden soubor nejvýše 50 MB')).toBeVisible()
    await expect(window.getByRole('button', { name: 'Uložit', exact: true })).toBeDisabled()
    // The list of documents is still on the page under the window.
    await expect(page.locator('.admin-table').first()).toBeVisible()
  })

  test('Dávka souborů se uloží, okno se zavře a přehled ukáže zpracování', async ({ page }) => {
    await signIn(page)
    await openUploadWindow(page)
    await chooseFiles(page, [
      demoFile('smlouva-najem-salu.pdf', 'najem-salu-2023.pdf'),
      demoFile('foto-kostel-leto.jpg', 'kostel-z-veze.jpg'),
    ])

    const first = batchItem(page, 'najem-salu-2023.pdf')
    const second = batchItem(page, 'kostel-z-veze.jpg')
    await first.getByLabel('Kategorie').selectOption({ label: 'Smlouvy' })
    await first.getByRole('button', { name: 'Doplnit popis' }).click()
    await first.getByRole('textbox').fill('Vzor smlouvy pro nájem sálu.')

    // Opening another item's description must not lose this one.
    await second.getByRole('button', { name: 'Doplnit popis' }).click()
    await expect(first.getByRole('textbox')).toHaveValue('Vzor smlouvy pro nájem sálu.')

    await uploadWindow(page).getByRole('button', { name: 'Uložit 2 soubory' }).click()
    await expect(uploadWindow(page)).toHaveCount(0)

    await expect(adminRow(page, 'najem-salu-2023.pdf')).toContainText('Připraveno')
    await expect(adminRow(page, 'najem-salu-2023.pdf')).toContainText('Smlouvy')
    await expect(adminRow(page, 'kostel-z-veze.jpg')).toContainText('Připraveno')

    // Stored for good: the documents are still there after the page is loaded again.
    await page.reload()
    await expect(adminRow(page, 'kostel-z-veze.jpg')).toContainText('Nezařazené')

    await openLibrary(page)
    await expect(page.getByText('14 dokumentů')).toBeVisible()
    const contract = page.locator('.doc-row').filter({ hasText: 'Vzor smlouvy pro nájem sálu.' })
    await expect(contract).toContainText('najem-salu-2023')
    // The year in the file name was picked up.
    await page.getByLabel('Rok vydání').selectOption('2023')
    await expect(page.locator('.document-link')).toHaveText(['najem-salu-2023 (název z obsahu)'])
  })

  test('Během ukládání je vidět průběh', async ({ page }) => {
    await signIn(page)
    await openUploadWindow(page)
    await chooseFiles(page, demoFile('projekt-cyklostezka.pdf', 'pomaly.pdf'))

    // The server takes its time with the file, so the state in between can be seen.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/upload/*', async (route) => {
      await held
      await route.continue()
    })

    const window = uploadWindow(page)
    await window.getByRole('button', { name: 'Uložit 1 soubor' }).click()
    const item = batchItem(page, 'pomaly.pdf')
    await expect(item).toContainText('Nahrává se')
    await expect(item.getByRole('progressbar')).toBeVisible()
    await expect(window.getByRole('button', { name: 'Zavřít' })).toBeDisabled()

    release()
    await expect(window).toHaveCount(0)
    await expect(adminRow(page, 'pomaly.pdf')).toContainText('Připraveno')
  })

  test('Dokument čeká a zpracovává se až v přehledu', async ({ page }) => {
    await signIn(page)
    await openUploadWindow(page)
    // The test model takes its time with a file of this name.
    await chooseFiles(page, demoFile('projekt-cyklostezka.pdf', 'cte-se-pomalu.pdf'))
    await uploadWindow(page).getByRole('button', { name: 'Uložit 1 soubor' }).click()
    await expect(uploadWindow(page)).toHaveCount(0)

    const row = adminRow(page, 'cte-se-pomalu.pdf')
    await expect(row).toContainText('Zpracovává se')
    await expect(row).toContainText('Připraveno')
  })

  test('Nahraný soubor lze otevřít a stáhnout beze změny', async ({ page }) => {
    const file = demoFile('projekt-cyklostezka.pdf', 'studie-stezky.pdf')
    await signIn(page)
    await uploadFiles(page, [file])

    await openLibrary(page)
    await page.locator('.document-link', { hasText: 'studie-stezky' }).click()
    await expect(page.getByText('z 2')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Stáhnout' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('studie-stezky.pdf')
    expect(readFileSync(await download.path()).equals(file.buffer)).toBe(true)
  })

  test('Obrázek dostane zmenšený náhled a plná verze se načte až po otevření', async ({ page }) => {
    const file = demoFile('plan-navsi-1936.png', 'plan-kopie.png')
    await signIn(page)
    await uploadFiles(page, [file])
    await openLibrary(page)

    const originals: string[] = []
    page.on('request', (request) => {
      if (/\/soubor\/[^/]+$/.test(new URL(request.url()).pathname)) originals.push(request.url())
    })
    await page.getByRole('searchbox').fill('plan-kopie')
    // The search runs on the server; the previews must be those of the result only.
    await expect(page.locator('.document-link')).toHaveCount(1)
    await page.getByRole('radio', { name: 'Náhled' }).click()

    const thumbnail = page.getByRole('img', { name: 'Náhled dokumentu plan-kopie' })
    await expect(thumbnail).toHaveAttribute('src', /\/soubor\/[0-9a-f-]+\/nahled$/)
    await expect
      .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(640)

    const response = await page.request.get((await thumbnail.getAttribute('src')) ?? '')
    expect(response.headers()['content-type']).toBe('image/webp')
    expect((await response.body()).byteLength).toBeLessThan(file.buffer.byteLength / 2)
    // Up to here the browser has not asked for the original at all.
    expect(originals).toEqual([])

    await page.locator('.document-link', { hasText: 'plan-kopie' }).click()
    const full = page.getByRole('img', { name: 'plan-kopie (název z obsahu)', exact: true })
    await expect
      .poll(() => full.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1600)
    expect(originals).toHaveLength(1)
  })

  test('Chyba jednoho souboru neblokuje ostatní a okno zůstane otevřené', async ({ page }) => {
    await signIn(page)
    await openUploadWindow(page)
    await chooseFiles(page, [
      demoFile('projekt-cyklostezka.pdf', 'stezka-kopie.pdf'),
      { name: 'poznamky.pdf', mimeType: 'application/pdf', buffer: Buffer.from('obyčejný text') },
    ])

    const window = uploadWindow(page)
    await expect(batchItem(page, 'poznamky.pdf').getByRole('alert')).toContainText(
      'Nepodporovaný formát',
    )
    await window.getByRole('button', { name: 'Uložit 1 soubor' }).click()
    await expect(batchItem(page, 'stezka-kopie.pdf')).toContainText('Uloženo')
    // The refused file keeps the window open, so its reason can be read.
    await expect(batchItem(page, 'poznamky.pdf').getByRole('alert')).toBeVisible()

    await window.getByRole('button', { name: 'Zavřít' }).click()
    await expect(window).toHaveCount(0)
    await expect(adminRow(page, 'stezka-kopie.pdf')).toContainText('Připraveno')
    await expect(adminRow(page, 'poznamky.pdf')).toHaveCount(0)
  })

  test('Stejný soubor se podruhé nezaloží', async ({ page }) => {
    await signIn(page)
    await openUploadWindow(page)
    // Exactly the bytes of a document the archive already holds.
    await chooseFiles(page, 'public/demo/projekt-cyklostezka.pdf')
    const item = batchItem(page, 'projekt-cyklostezka.pdf')
    await expect(item.getByRole('alert')).toContainText(
      'Tento soubor už v archivu je jako „Cyklostezka k nádraží, studie první etapy“',
    )
    await expect(
      uploadWindow(page).getByRole('button', { name: 'Uložit', exact: true }),
    ).toBeDisabled()

    await item.getByRole('link', { name: 'Otevřít existující dokument' }).click()
    await expect(
      page.getByRole('heading', { name: 'Cyklostezka k nádraží, studie první etapy' }),
    ).toBeVisible()
  })

  test('Odstraněný dokument zmizí i z úložiště', async ({ page }) => {
    await signIn(page)
    expect((await page.request.get('/soubor/foto-hody-1974')).status()).toBe(200)
    expect((await page.request.get('/soubor/foto-hody-1974/nahled')).status()).toBe(200)

    await showMostRows(page)
    await page.getByRole('button', { name: 'Odstranit: Hodový průvod' }).click()
    await page
      .getByRole('dialog', { name: 'Odstranit dokument?' })
      .getByRole('button', { name: 'Odstranit dokument' })
      .click()
    await expect(adminRow(page, 'Hodový průvod')).toHaveCount(0)

    expect((await page.request.get('/soubor/foto-hody-1974')).status()).toBe(404)
    expect((await page.request.get('/soubor/foto-hody-1974/nahled')).status()).toBe(404)
  })
})
