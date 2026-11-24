import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  adminRow,
  categoryEditor,
  chooseCategory,
  openAdminPage,
  openLibrary,
  signIn,
} from '../support/admin'
import { resetArchive } from '../support/database'
import {
  batchItem,
  chooseFiles,
  demoFile,
  openUploadWindow,
  uploadWindow,
  type TestFile,
} from '../support/upload'

/** A PDF whose first page has a text layer and whose second page is a scan. */
async function mixedPdf(name: string): Promise<TestFile> {
  const mixed = await PDFDocument.create()
  for (const source of ['projekt-cyklostezka.pdf', 'zapis-zastupitelstvo-1998-sken.pdf']) {
    const document = await PDFDocument.load(readFileSync(`public/demo/${source}`))
    const [page] = await mixed.copyPages(document, [0])
    if (page !== undefined) mixed.addPage(page)
  }
  mixed.setSubject(randomBytes(8).toString('hex'))
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await mixed.save()) }
}

/** A PDF whose first page is plain text and whose second page has text and a photograph. */
async function picturedPdf(name: string): Promise<TestFile> {
  const pictured = await PDFDocument.create()
  const source = await PDFDocument.load(readFileSync('public/demo/projekt-cyklostezka.pdf'))
  const [first] = await pictured.copyPages(source, [0])
  if (first !== undefined) pictured.addPage(first)
  const page = pictured.addPage([595, 842])
  page.drawText('Fotografie z kontrolniho dne na stavbe cyklostezky.', {
    x: 50,
    y: 780,
    size: 12,
    font: await pictured.embedFont(StandardFonts.Helvetica),
  })
  const photo = await pictured.embedJpg(readFileSync('public/demo/foto-kostel-leto.jpg'))
  page.drawImage(photo, { x: 50, y: 400, width: 400, height: 300 })
  pictured.setSubject(randomBytes(8).toString('hex'))
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pictured.save()) }
}

/** Signs in and stores one file, optionally with the administrator's own description. */
async function upload(
  page: Page,
  file: TestFile,
  description = '',
  outcome: 'Zveřejněno' | 'Chyba' = 'Zveřejněno',
) {
  await signIn(page)
  await openUploadWindow(page)
  await chooseFiles(page, file)
  if (description !== '') {
    const item = batchItem(page, file.name)
    await item.getByRole('button', { name: 'Doplnit popis' }).click()
    await item.getByRole('textbox').fill(description)
  }
  await uploadWindow(page).getByRole('button', { name: 'Uložit 1 soubor' }).click()
  await expect(uploadWindow(page)).toHaveCount(0)
  await expect(adminRow(page, file.name)).toContainText(outcome)
}

/** Opens the edit dialog of a document and returns the text processing took from it. */
async function extractedText(page: Page, title: string) {
  await page.getByRole('button', { name: `Upravit: ${title}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Upravit dokument' })
  await dialog.getByText('Text a popis získaný z dokumentu').click()
  return dialog.locator('.extracted-text')
}

// Scenarios: features/admin/zpracovani.feature
test.describe('Zpracování obsahu dokumentu', () => {
  test.beforeEach(resetArchive)

  test('Obrázek dostane název a popisy z obsahu a název souboru zůstane vidět', async ({
    page,
  }) => {
    await upload(page, demoFile('foto-kostel-leto.jpg', 'IMG_4521.jpg'))
    await expect(adminRow(page, 'IMG_4521 (název z obsahu)')).toContainText('Zveřejněno')

    await expect(await extractedText(page, 'IMG_4521 (název z obsahu)')).toHaveText(
      'Zkušební popis obrázku ze souboru IMG_4521.jpg. Popis má několik vět.',
    )
    await page.getByRole('button', { name: 'Zrušit' }).click()

    await openLibrary(page)
    const short = 'Zkušební krátký popis obrázku IMG_4521.jpg.'
    await expect(
      page.locator('.doc-row').filter({ hasText: 'IMG_4521 (název z obsahu)' }),
    ).toContainText(short)
    await expect(
      page.locator('.doc-row').filter({ hasText: 'IMG_4521' }).locator('.document-filename'),
    ).toHaveText('IMG_4521.jpg')
    // The file name is searched as well.
    await page.getByRole('searchbox').fill('img_4521.jpg')
    await expect(page.locator('.document-link')).toHaveText(['IMG_4521 (název z obsahu)'])
    await page.getByRole('radio', { name: 'Náhled' }).click()
    await expect(
      page.locator('.preview-card').filter({ hasText: 'IMG_4521 (název z obsahu)' }),
    ).toContainText(short)
  })

  test('PDF s textovou vrstvou dostane název z obsahu a uloží celý text', async ({ page }) => {
    await upload(page, demoFile('projekt-cyklostezka.pdf', 'studie-stezky.pdf'))
    await expect(adminRow(page, 'studie-stezky.pdf')).toContainText('Zveřejněno')

    const text = await extractedText(page, 'studie-stezky')
    await expect(text).toContainText('strana 1 z 2')
    await expect(text).toContainText('strana 2 z 2')
    await page.getByRole('button', { name: 'Zrušit' }).click()

    await openLibrary(page)
    const row = page.locator('.doc-row').filter({ hasText: 'studie-stezky' })
    await expect(row.locator('.document-link')).toHaveText('studie-stezky (název z obsahu)')
    await expect(row.locator('.document-filename')).toHaveText('studie-stezky.pdf')
    await expect(row).toContainText('Zkušební krátký popis dokumentu studie-stezky.pdf.')
  })

  test('PDF bez textové vrstvy se přečte jako sken', async ({ page }) => {
    await upload(page, demoFile('zapis-zastupitelstvo-1998-sken.pdf', 'scan_0001.pdf'))
    await expect(adminRow(page, 'scan_0001.pdf')).toContainText('scan_0001 (název z obsahu)')
    await expect(await extractedText(page, 'scan_0001 (název z obsahu)')).toHaveText(
      'Zkušební text přečtený ze skenu.',
    )
  })

  test('PDF se smíšenými stranami se přečte celé', async ({ page }) => {
    await upload(page, await mixedPdf('smiseny-zapis.pdf'))
    const text = await extractedText(page, 'smiseny-zapis')
    await expect(text).toContainText('Cyklostezka k nádraží')
    await expect(text).toContainText('Zkušební text přečtený ze skenu.')
  })

  test('Stranu s textem a obrázkem přečte model, stranu jen s textem ne', async ({ page }) => {
    await upload(page, await picturedPdf('stezka-s-fotkou.pdf'))
    await adminRow(page, 'stezka-s-fotkou.pdf').click()
    const steps = page
      .getByRole('complementary', { name: 'Ladění zpracování' })
      .locator('.debug-run')
      .first()
      .locator('.debug-steps > li')
    const layout = steps.filter({ hasText: 'Rozbor stran PDF' })
    await expect(layout).toContainText('Strana 1: jen text, čte se přímo.')
    await expect(layout).toContainText('Strana 2: text a obrázky (1), čte model.')
    // One page went to the model, with its text layer; the plain page did not.
    const read = steps.filter({ hasText: 'Čtení strany s tabulkou nebo obrázkem' })
    await expect(read).toHaveCount(1)
    await expect(read).toContainText('strana 2')
    await expect(read).toContainText('Fotografie z kontrolniho dne')
    await expect(steps.filter({ hasText: 'Čtení naskenované strany' })).toHaveCount(0)

    const text = await extractedText(page, 'stezka-s-fotkou')
    await expect(text).toContainText('Cyklostezka k nádraží')
    await expect(text).toContainText('Fotografie z kontrolniho dne na stavbe cyklostezky.')
    await expect(text).toContainText('[Obrázek: zkušební přepis strany 2 modelem.]')
  })

  test('Vlastní popis má v knihovně přednost před krátkým popisem', async ({ page }) => {
    await upload(page, demoFile('smlouva-najem-salu.pdf', 'najem-vzor.pdf'), 'Popis od správce.')
    await openLibrary(page)
    const row = page.locator('.doc-row').filter({ hasText: 'najem-vzor' })
    await expect(row).toContainText('Popis od správce.')
    await expect(row).not.toContainText('Zkušební krátký popis')
  })

  test('Nepovedené zpracování dokument nezveřejní', async ({ page }) => {
    await upload(page, demoFile('smlouva-najem-salu.pdf', 'selhani-cteni.pdf'), '', 'Chyba')
    const row = adminRow(page, 'selhani-cteni')
    await expect(row).toContainText('Chyba')
    await expect(row).toContainText('Čtení obsahu pomocí AI se nepodařilo.')

    await openLibrary(page)
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    await expect(page.getByText('selhani-cteni')).toHaveCount(0)
  })

  test('Zpracování lze zopakovat a ručně zadaný název zůstane', async ({ page }) => {
    await signIn(page)
    await expect(adminRow(page, 'Kronika obce, rok 1952')).toContainText('Chyba')
    await page.getByRole('button', { name: 'Zpracovat znovu: Kronika obce, rok 1952' }).click()
    await expect(
      page.getByText('Zpracování dokumentu „Kronika obce, rok 1952“ skončilo.'),
    ).toBeVisible()
    const row = adminRow(page, 'Kronika obce, rok 1952')
    await expect(row).toContainText('Zveřejněno')
    await expect(row).not.toContainText('Strany 4 až 9 jsou poškozené')

    await openLibrary(page)
    await expect(page.getByText('13 dokumentů')).toBeVisible()
    await expect(
      page.locator('.doc-row').filter({ hasText: 'Kronika obce, rok 1952' }),
    ).toContainText('Zkušební krátký popis dokumentu')
  })

  test('Kategorii určí AI, když ji správce nevybral', async ({ page }) => {
    await signIn(page)
    await openUploadWindow(page)
    await chooseFiles(page, demoFile('zapis-zastupitelstvo-2026-03.pdf', 'zapis-rady.pdf'))
    await expect(batchItem(page, 'zapis-rady.pdf').getByLabel('Kategorie')).toHaveValue('')
    await expect(
      batchItem(page, 'zapis-rady.pdf').getByLabel('Kategorie').locator('option:checked'),
    ).toHaveText('Určí AI')
    await uploadWindow(page).getByRole('button', { name: 'Uložit 1 soubor' }).click()

    const row = adminRow(page, 'zapis-rady.pdf')
    await expect(row).toContainText('Zveřejněno')
    await expect(row).toContainText('Zápisy')
  })

  test('Kategorii vybranou správcem AI nezmění', async ({ page }) => {
    await signIn(page)
    await openUploadWindow(page)
    await chooseFiles(page, demoFile('zapis-zastupitelstvo-2026-03.pdf', 'zapis-komise.pdf'))
    await batchItem(page, 'zapis-komise.pdf')
      .getByLabel('Kategorie')
      .selectOption({ label: 'Smlouvy' })
    await uploadWindow(page).getByRole('button', { name: 'Uložit 1 soubor' }).click()

    const row = adminRow(page, 'zapis-komise.pdf')
    await expect(row).toContainText('Zveřejněno')
    await expect(row).toContainText('Smlouvy')
    await expect(row).not.toContainText('Zápisy')
  })

  test('Dokument, ke kterému AI kategorii nenajde, zůstane nezařazený', async ({ page }) => {
    await upload(page, demoFile('projekt-cyklostezka.pdf', 'studie-stezky.pdf'))
    await expect(adminRow(page, 'studie-stezky.pdf')).toContainText('Nezařazené')
  })

  test('Datum dokumentu určí zpracování a správce ho může opravit', async ({ page }) => {
    // The test model dates a file named "*datum*" 17. 5. 2021.
    await upload(page, demoFile('smlouva-najem-salu.pdf', 'smlouva-datum.pdf'))
    await page.getByRole('link', { name: 'Dokumenty', exact: true }).click()
    await page.getByLabel('Řazení').selectOption('vydane-z')
    const row = page.locator('.doc-row').filter({ hasText: 'smlouva-datum' })
    await expect(row).toContainText('17. 5. 2021')
    // A list by the date of the documents has a heading for the month.
    await expect(page.locator('.doc-group').filter({ hasText: 'květen 2021' })).toBeVisible()
    await page.getByLabel('Rok vydání').selectOption('2021')
    await expect(page.locator('.doc-row')).toHaveCount(1)

    await page.getByRole('link', { name: 'Zpracování' }).click()
    await page.getByRole('button', { name: 'Upravit: smlouva-datum' }).click()
    const dialog = page.getByRole('dialog', { name: 'Upravit dokument' })
    await dialog.getByLabel('Datum dokumentu').fill('2019-03-02')
    await dialog.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('link', { name: 'Dokumenty', exact: true }).click()
    await page.getByLabel('Řazení').selectOption('vydane-z')
    await expect(row).toContainText('2. 3. 2019')
    await expect(page.locator('.doc-group').filter({ hasText: 'březen 2019' })).toBeVisible()
  })

  test('Panel ladění ukáže postup zpracování dokumentu', async ({ page }) => {
    await upload(page, demoFile('zapis-zastupitelstvo-1998-sken.pdf', 'zapis-sken.pdf'))
    const debug = page.getByRole('complementary', { name: 'Ladění zpracování' })
    await expect(debug).toContainText('Klikněte na dokument v seznamu.')

    await adminRow(page, 'zapis-sken.pdf').click()
    await expect(adminRow(page, 'zapis-sken.pdf')).toHaveAttribute('aria-selected', 'true')
    const run = debug.locator('.debug-run').first()
    await expect(run).toContainText('Hotovo')
    // The sums of the run: calls, tokens and money.
    const facts = run.locator('.debug-facts')
    await expect(facts).toContainText('Volání modelů4')
    await expect(facts).toContainText('dovnitř')
    await expect(facts).toContainText('0,0046 $')

    // What processing did itself, in the order it happened.
    const steps = run.locator('.debug-steps > li')
    await expect(steps.nth(0)).toContainText('Načtení souboru z úložiště')
    await expect(steps.nth(1)).toContainText('Rozbor stran PDF')
    await expect(steps.nth(1)).toContainText('Strana 1: bez textové vrstvy, čte model.')
    // A model call: the model, what it got, what it returned and what it cost.
    const read = steps.filter({ hasText: 'Čtení naskenované strany' })
    await expect(read).toContainText('fake:test')
    await expect(read).toContainText('Co model dostal')
    await expect(read).toContainText('Co model vrátil')
    await expect(read).toContainText('tokenů dovnitř')
    await expect(steps.filter({ hasText: 'Určení kategorie' })).toContainText('fake:decision')
    await expect(steps.filter({ hasText: 'Embedding' }).last()).toContainText('fake:embedding')
    // What was stored and where.
    await expect(steps.filter({ hasText: 'documents.status' })).toContainText('ready')
    await expect(steps.filter({ hasText: 'documents.category_id' })).toContainText('Zápisy')
    await expect(steps.filter({ hasText: 'document_chunks' }).first()).toContainText('řádků')

    await debug.getByText('Co je teď uložené v archivu').click()
    await expect(debug.locator('.debug-card').last()).toContainText('documents.storage_key')
  })

  test('Nepovedené volání je v panelu ladění i s chybou', async ({ page }) => {
    await upload(page, demoFile('smlouva-najem-salu.pdf', 'selhani-cteni.pdf'), '', 'Chyba')
    await adminRow(page, 'selhani-cteni.pdf').click()
    const run = page
      .getByRole('complementary', { name: 'Ladění zpracování' })
      .locator('.debug-run')
      .first()
    await expect(run).toContainText('Chyba')
    await expect(run.locator('.call--failed')).toContainText('The fake reader was asked to fail.')
    await expect(
      run.locator('.debug-steps > li').filter({ hasText: 'documents.status' }),
    ).toContainText('failed')
  })

  test('Popis kategorie je součástí zadání pro model, který kategorii vybírá', async ({ page }) => {
    await signIn(page)
    await openAdminPage(page, 'Kategorie')
    const hint = categoryEditor(page).getByRole('textbox', { name: 'Popis' })
    await chooseCategory(page, 'Zápisy')
    await hint.fill('Zápisy a usnesení ze zasedání zastupitelstva obce.')
    await categoryEditor(page).getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page.getByText('Kategorie „Zápisy“ je uložená.')).toBeVisible()
    // Stored: it is there after the page is loaded again.
    await page.reload()
    await chooseCategory(page, 'Zápisy')
    await expect(hint).toHaveValue('Zápisy a usnesení ze zasedání zastupitelstva obce.')

    await openUploadWindow(page)
    await chooseFiles(page, demoFile('zapis-zastupitelstvo-1998-sken.pdf', 'zapis-sken.pdf'))
    await uploadWindow(page).getByRole('button', { name: 'Uložit 1 soubor' }).click()
    await expect(adminRow(page, 'zapis-sken.pdf')).toContainText('Zveřejněno')

    await adminRow(page, 'zapis-sken.pdf').click()
    const call = page
      .getByRole('complementary', { name: 'Ladění zpracování' })
      .locator('.debug-steps > li')
      .filter({ hasText: 'Určení kategorie' })
    await expect(call).toContainText(
      'Zápisy: Dokument svým obsahem a účelem patří do kategorie „Zápisy“. Co do kategorie patří: Zápisy a usnesení ze zasedání zastupitelstva obce.',
    )
  })
})
