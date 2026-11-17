import { expect, test, type Page } from '@playwright/test'
import { adminRow, openAdminPage, signIn } from '../support/admin'
import { resetArchive } from '../support/database'
import { uploadDemoFile } from '../support/upload'

const openSkills = (page: Page) => openAdminPage(page, 'Skilly')
const list = (page: Page) => page.getByRole('navigation', { name: 'Seznam skillů' })
const group = (page: Page, name: string) => list(page).getByRole('region', { name })
/** The line of a skill in the list on the left. */
const item = (page: Page, title: string) =>
  list(page)
    .locator('.skills-nav__item')
    .filter({ has: page.locator('strong', { hasText: new RegExp(`^${title}$`) }) })
/** The editor on the right, with the skill that is open. */
const editor = (page: Page, title: string) => page.getByRole('form', { name: title })
const text = (page: Page, title: string) => editor(page, title).getByLabel('Zadání')
const debug = (page: Page) => page.getByRole('complementary', { name: 'Ladění zpracování' })

/** Opens a skill from the list and returns its editor. */
async function open(page: Page, title: string) {
  await item(page, title).click()
  await expect(editor(page, title)).toBeVisible()
  return editor(page, title)
}

// Scenarios: features/admin/skilly.feature
test.describe('Skilly: systémový prompt, úpravy a vlastní skilly', () => {
  test.beforeEach(resetArchive)

  test('Vlevo je seznam skillů ve dvou skupinách, vpravo jeden skill k úpravě', async ({
    page,
  }) => {
    await signIn(page)
    await openSkills(page)
    const processing = group(page, 'Zpracování dokumentů a obrázků')
    const chat = group(page, 'Chat')
    await expect(processing.locator('.skills-nav__item')).toHaveCount(5)
    await expect(chat.locator('.skills-nav__item')).toHaveCount(4)
    // The system prompt is the first line of its group.
    await expect(processing.locator('.skills-nav__item').first()).toContainText(
      'Systémový prompt pro zpracování',
    )
    await expect(chat.locator('.skills-nav__item').first()).toContainText(
      'Systémový prompt pro chat',
    )

    // The first skill is open, and its line is marked.
    await expect(item(page, 'Čtení strany')).toHaveAttribute('aria-current', 'true')
    await expect(editor(page, 'Čtení strany')).toContainText('zpracovani/cteni-strany')

    // A skill is Markdown, and says where it is attached.
    const date = await open(page, 'Datum a rok dokumentu')
    await expect(date).toContainText('Výchozí znění')
    await expect(text(page, 'Datum a rok dokumentu')).toHaveValue(/## Zpravodaj/)
    await expect(date.getByRole('checkbox')).toHaveCount(5)
    await expect(date.getByLabel('Popis dokumentu (název, popis, rok, datum)')).toBeChecked()
    await expect(date.getByLabel('Popis obrázku')).toBeChecked()
    await expect(date.getByLabel('Čtení naskenované strany')).not.toBeChecked()
    await expect(date.getByRole('button', { name: 'Uložit změny' })).toBeDisabled()

    // A system prompt goes to every call of its group, so it has no places to tick.
    const system = await open(page, 'Systémový prompt pro chat')
    await expect(system.getByRole('checkbox')).toHaveCount(0)
    await expect(text(page, 'Systémový prompt pro chat')).toHaveValue(
      /Jsi asistent archivu dokumentů/,
    )

    // Nothing judges the skills and proposes changes any more.
    await expect(page.getByText('Poslední vyhodnocení')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Vyhodnotit/ })).toHaveCount(0)
  })

  test('Správce upraví skill a další zpracování ho dostane', async ({ page }) => {
    await signIn(page)
    await openSkills(page)
    const reading = await open(page, 'Čtení strany')
    await expect(text(page, 'Čtení strany')).toHaveValue(/Dostaneš jednu stranu dokumentu/)
    await text(page, 'Čtení strany').fill(
      '# Strana\n\nPřepiš stranu slovo od slova. Zkušební úprava správce.',
    )
    await expect(reading.getByRole('status')).toHaveText('Neuložené změny')

    // "Zrušit" puts the stored text back.
    await reading.getByRole('button', { name: 'Zrušit' }).click()
    await expect(text(page, 'Čtení strany')).toHaveValue(/Dostaneš jednu stranu dokumentu/)
    await expect(reading.getByRole('status')).toHaveText('')

    await text(page, 'Čtení strany').fill(
      '# Strana\n\nPřepiš stranu slovo od slova. Zkušební úprava správce.',
    )
    await reading.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(
      page.getByText('Skill „Čtení strany“ je uložený a platí pro další volání.'),
    ).toBeVisible()
    await expect(reading).toContainText('Verze 1')
    await expect(text(page, 'Čtení strany')).toHaveValue(/Zkušební úprava správce\./)

    await uploadDemoFile(page, 'zapis-zastupitelstvo-1998-sken.pdf', 'zapis-sken.pdf')
    await adminRow(page, 'zapis-sken.pdf').click()
    const read = debug(page)
      .locator('.debug-steps > li')
      .filter({ hasText: 'Čtení naskenované strany' })
    // The call got the system prompt and the edited skill of the place.
    await expect(read.locator('.call__skills li')).toHaveText([
      'zpracovani/systemvýchozí znění',
      'zpracovani/cteni-stranyverze 1',
    ])
    await expect(read).toContainText('Zpracováváš dokumenty a obrázky pro veřejný archiv')
    await expect(read).toContainText('Zkušební úprava správce.')

    // The starting text is one click away.
    await openSkills(page)
    await editor(page, 'Čtení strany').getByRole('button', { name: 'Vrátit výchozí znění' }).click()
    await expect(page.getByText('Skill „Čtení strany“ má znovu výchozí znění.')).toBeVisible()
    await expect(editor(page, 'Čtení strany')).toContainText('Výchozí znění')
    await expect(text(page, 'Čtení strany')).toHaveValue(/Dostaneš jednu stranu dokumentu/)
  })

  test('Správce změní, kde se skill použije', async ({ page }) => {
    await signIn(page)
    await openSkills(page)
    const reading = await open(page, 'Čtení strany')
    await reading.getByLabel('Čtení naskenované strany').uncheck()
    // A skill with no place cannot be saved: no call would get it.
    await reading.getByLabel('Čtení strany s tabulkou nebo obrázkem').uncheck()
    await expect(reading.getByText('Skill musí mít aspoň jedno místo.')).toBeVisible()
    await expect(reading.getByRole('button', { name: 'Uložit změny' })).toBeDisabled()
    await reading.getByLabel('Čtení strany s tabulkou nebo obrázkem').check()
    await reading.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(
      page.getByText('Skill „Čtení strany“ je uložený a platí pro další volání.'),
    ).toBeVisible()
    await expect(
      editor(page, 'Čtení strany').getByLabel('Čtení naskenované strany'),
    ).not.toBeChecked()

    await uploadDemoFile(page, 'zapis-zastupitelstvo-1998-sken.pdf', 'zapis-sken.pdf')
    await adminRow(page, 'zapis-sken.pdf').click()
    const read = debug(page)
      .locator('.debug-steps > li')
      .filter({ hasText: 'Čtení naskenované strany' })
    // The reading of the scan no longer gets the skill.
    await expect(read.locator('.call__skills li')).toHaveText(['zpracovani/systemvýchozí znění'])

    await openSkills(page)
    await editor(page, 'Čtení strany').getByRole('button', { name: 'Vrátit výchozí znění' }).click()
    await expect(editor(page, 'Čtení strany').getByLabel('Čtení naskenované strany')).toBeChecked()
  })

  test('Správce přidá vlastní skill a systém ho přiloží tam, kde má být', async ({ page }) => {
    await signIn(page)
    await openSkills(page)
    await page.getByRole('button', { name: 'Přidat skill' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nový skill' })
    // The group of the open skill is chosen, and only its places are offered.
    await expect(
      dialog.getByRole('radio', { name: 'Zpracování dokumentů a obrázků' }),
    ).toBeChecked()
    await expect(dialog.getByRole('checkbox')).toHaveCount(5)
    await expect(dialog.getByRole('button', { name: 'Přidat skill' })).toBeDisabled()
    await dialog.getByLabel('Název skillu').fill('Názvy zápisů')
    await dialog.getByLabel('Popis dokumentu (název, popis, rok, datum)').check()
    await dialog
      .getByLabel('Text skillu v Markdownu')
      .fill('Název zápisu vždy začíná slovem Zápis.')
    await dialog.getByRole('button', { name: 'Přidat skill' }).click()
    await expect(
      page.getByText('Skill „Názvy zápisů“ je přidaný a platí pro další volání.'),
    ).toBeVisible()

    // The new skill is in the list and is the one that is open.
    await expect(item(page, 'Názvy zápisů')).toHaveAttribute('aria-current', 'true')
    const own = editor(page, 'Názvy zápisů')
    await expect(own).toContainText('Vlastní skill')
    await expect(own).toContainText('vlastni/nazvy-zapisu')
    await expect(own).toContainText('Verze 1')

    await uploadDemoFile(page, 'zapis-zastupitelstvo-1998-sken.pdf', 'zapis-sken.pdf')
    await adminRow(page, 'zapis-sken.pdf').click()
    const steps = debug(page).locator('.debug-steps > li')
    // The description of the document got it; the reading of the page did not.
    const described = steps.filter({ hasText: 'fake:description' })
    await expect(described.locator('.call__skills')).toContainText('vlastni/nazvy-zapisu')
    await expect(described).toContainText('# Skill: Názvy zápisů')
    await expect(described).toContainText('Název zápisu vždy začíná slovem Zápis.')
    const read = steps.filter({ hasText: 'Čtení naskenované strany' })
    await expect(read.locator('.call__skills')).not.toContainText('vlastni/nazvy-zapisu')
  })

  test('Vlastní skill lze přejmenovat, vypnout a odstranit', async ({ page }) => {
    await signIn(page)
    await openSkills(page)
    await page.getByRole('button', { name: 'Přidat skill' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nový skill' })
    await dialog.getByRole('radio', { name: 'Chat' }).check()
    await expect(dialog.getByRole('checkbox')).toHaveCount(2)
    await dialog.getByLabel('Název skillu').fill('Tykání')
    await dialog.getByLabel('Odpověď v chatu').check()
    await dialog.getByLabel('Text skillu v Markdownu').fill('Návštěvníkovi vykej.')
    await dialog.getByRole('button', { name: 'Přidat skill' }).click()
    await expect(group(page, 'Chat').locator('.skills-nav__item')).toHaveCount(5)

    await editor(page, 'Tykání').getByLabel('Název skillu').fill('Vykání')
    await editor(page, 'Tykání').getByRole('button', { name: 'Uložit změny' }).click()
    await expect(item(page, 'Vykání')).toBeVisible()
    const own = editor(page, 'Vykání')

    await own.getByRole('button', { name: 'Vypnout' }).click()
    await expect(
      page.getByText('Skill „Vykání“ je vypnutý. Žádné volání ho nedostane.'),
    ).toBeVisible()
    await expect(item(page, 'Vykání')).toContainText('Vypnutý')

    await own.getByRole('button', { name: 'Odstranit: Vykání' }).click()
    await page
      .getByRole('dialog', { name: 'Odstranit skill?' })
      .getByRole('button', { name: 'Odstranit skill' })
      .click()
    await expect(page.getByText('Skill „Vykání“ je odstraněný.')).toBeVisible()
    await expect(item(page, 'Vykání')).toHaveCount(0)
    // A skill of the system has no such buttons.
    const search = await open(page, 'Hledání v archivu')
    await expect(search.getByRole('button', { name: /Odstranit/ })).toHaveCount(0)
    await expect(search.getByRole('button', { name: 'Vypnout' })).toHaveCount(0)
  })

  test('Chat dostane systémový prompt a skilly chatu', async ({ page }) => {
    await signIn(page)
    await openSkills(page)
    const answer = await open(page, 'Odpověď a citace')
    await text(page, 'Odpověď a citace').fill('Odpovídej jen z úryvků. Zkušební pravidlo chatu.')
    await answer.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(answer).toContainText('Verze 1')

    await openAdminPage(page, 'Ladění chatu')
    await page.getByLabel('Zkušební otázka').fill('Kdo opravuje chodník?')
    await page.getByRole('button', { name: 'Zeptat se' }).click()
    const trace = page.locator('.trace').first()
    await trace.locator('summary').first().click()
    await expect(trace).toContainText('Jsi asistent archivu dokumentů obce Horní Moštěnice.')
    await expect(trace).toContainText('# Skill: Hledání v archivu')
    await expect(trace).toContainText('Zkušební pravidlo chatu.')
  })
})
