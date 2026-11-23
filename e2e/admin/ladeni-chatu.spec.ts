import { expect, test, type Locator, type Page } from '@playwright/test'
import { openAdminPage, signIn } from '../support/admin'
import { chatSessionIds, forgetChatTraces, resetArchive } from '../support/database'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FIRST = 'Kdo vymění veřejné osvětlení?'
/** The fake model adds up the amounts in crowns of what it found, in the sandbox. */
const SUM = 'Kolik obec dá celkem za osvětlení a dotace spolkům?'

/** Asks in the visitor's chat on the current page and waits for each answer. */
async function visitorAsks(page: Page, ...questions: string[]) {
  const chat = page.getByRole('complementary', { name: 'Chat nad archivem' })
  const input = chat.getByRole('textbox', { name: 'Otázka pro archiv' })
  const answers = chat.locator('.chat-message--archive')
  const before = await answers.count()
  for (const [index, question] of questions.entries()) {
    await input.fill(question)
    await input.press('Enter')
    await expect(answers).toHaveCount(before + index + 1)
    await expect(chat.locator('.chat-message--pending')).toHaveCount(0)
  }
}

/** Says under the newest answer of the visitor's chat whether it helped, and waits until it is stored. */
async function visitorRates(page: Page, name: 'Odpověď pomohla' | 'Odpověď nepomohla') {
  const row = page
    .getByRole('complementary', { name: 'Chat nad archivem' })
    .locator('.chat-message--archive')
    .last()
    .getByRole('group', { name: 'Hodnocení odpovědi' })
  await row.getByRole('button', { name, exact: true }).click()
  await expect(row.getByRole('status')).toHaveText('Děkujeme za hodnocení.')
}

/** Starts another conversation in the visitor's chat. */
async function visitorStartsNewChat(page: Page) {
  const chat = page.getByRole('complementary', { name: 'Chat nad archivem' })
  await chat.getByRole('button', { name: 'Nový chat' }).click()
  await expect(chat.locator('.chat-message')).toHaveCount(0)
}

/** Asks in the debugger's box; the box empties once the answer is in. */
async function tryQuestion(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Zkušební otázka' })
  await box.fill(question)
  await page.getByRole('button', { name: 'Zeptat se' }).click()
  await expect(box).toHaveValue('')
}

/** The rows of the list of sessions; shown only while no session is open. */
const sessionRows = (page: Page) => page.locator('.sessions .session:has(.session__open)')
/** The open session: its questions in order. */
const sessionView = (page: Page) => page.locator('.trace-session')
const questionTraces = (page: Page) => sessionView(page).locator('.session')
const questionTrace = (page: Page, question: string) =>
  questionTraces(page).filter({
    has: page.locator(`summary[aria-label="Zobrazit postup: ${question}"]`),
  })
/** The block "Historie pro model" of one opened question. */
const historyBlock = (page: Page, question: string) =>
  questionTrace(page, question).locator('.call').filter({ hasText: 'Historie pro model' })

/** The filter of the list of sessions by what the visitor said of them. */
const feedbackFilter = (page: Page) => page.getByRole('group', { name: 'Hodnocení', exact: true })
const filterChoice = (page: Page, name: string) =>
  feedbackFilter(page).getByRole('button', { name, exact: true })
const sessionTitles = (page: Page) => sessionRows(page).locator('.session__title')
/** The labels of feedback on a row: of a session in the list, or of a question in an open session. */
const feedbackLabels = (row: Locator) => row.locator('.session__feedback')

async function openQuestion(page: Page, question: string) {
  const trace = questionTrace(page, question)
  if (
    !(await trace
      .locator('details')
      .first()
      .evaluate((e: HTMLDetailsElement) => e.open))
  ) {
    await trace.locator('summary').first().click()
  }
  await expect(historyBlock(page, question)).toBeVisible()
}

// Scenarios: features/admin/ladeni-chatu.feature
test.describe('Ladění chatu', () => {
  test.beforeEach(resetArchive)

  test('Bez přihlášení není postup otázek vidět', async ({ page }) => {
    await page.goto('/sprava/chat')
    await expect(page.getByLabel('Heslo')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ladění chatu' })).toHaveCount(0)
  })

  test('Zkušební otázka ukáže celý postup krok za krokem', async ({ page }) => {
    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await expect(page.getByText('Zatím se nikdo nezeptal.')).toBeVisible()

    await tryQuestion(page, FIRST)

    // The question opened a session of its own, with the trace unfolded.
    await expect(page.getByRole('heading', { name: 'Rozhovor' })).toBeVisible()
    const trace = questionTraces(page).first()
    await expect(trace.locator('summary').first()).toContainText(FIRST)
    await expect(trace.locator('summary').first()).toContainText('Hledání: 1')

    // A small model writes the query, the search runs both branches, the chat model answers.
    const steps = trace.locator('.trace-step')
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toContainText('Přeformulování otázky')
    await expect(steps.nth(0)).toContainText('fake:rewrite')
    await expect(steps.nth(0)).toContainText(
      'Dotaz pro první hledání: Kdo vymění veřejné osvětlení?',
    )

    const search = steps.nth(1)
    await expect(search).toContainText('Hledání: „Kdo vymění veřejné osvětlení?“')
    const words = search.locator('.trace-branch').filter({ hasText: 'Větev slov (BM25)' })
    await expect(words.getByRole('row').nth(1)).toContainText('Zápis z 9. zasedání zastupitelstva')
    await expect(words.getByRole('columnheader', { name: 'Skóre BM25' })).toBeVisible()
    const meaning = search.locator('.trace-branch').filter({ hasText: 'Větev významu (embedding)' })
    await expect(meaning.getByRole('row').nth(1)).toContainText(
      'Zápis z 9. zasedání zastupitelstva',
    )
    // The decision model weighs the branches before the fusion and scores the pieces after it.
    await expect(search).toContainText('Váhy větví: slova 1,00, význam 1,00')
    await expect(search).toContainText(
      'dotaz je na přesná slova 20 %, na obojí 60 %, na význam 20 %',
    )
    const reranker = search.locator('.trace-decision').filter({ hasText: 'Reranker: jak dobře' })
    await expect(reranker).toContainText('fake:decision')
    await expect(reranker.getByRole('columnheader', { name: 'Skóre rerankeru' })).toBeVisible()
    await expect(reranker.getByRole('row').nth(1)).toContainText(
      'Zápis z 9. zasedání zastupitelstva',
    )
    await expect(reranker.getByRole('row').nth(1)).toContainText('ano')
    await expect(reranker.getByRole('columnheader', { name: 'Pořadí bez Jeva' })).toBeVisible()
    await expect(search).toContainText('Po rerankeru: tyto úryvky dostal model')

    // The order without the decision model is kept beside, only to compare.
    const compare = search.locator('.trace-compare')
    await expect(compare).toContainText('Porovnání: co by model dostal bez Jeva')
    await expect(compare).toContainText('Stejných úryvků:')
    const plain = compare.locator('.trace-passages li').first()
    await expect(plain).toContainText('1. Zápis z 9. zasedání zastupitelstva')
    await expect(plain).toContainText('reranker: 0,75')
    await expect(plain).toContainText('dostal i s Jevem')
    const passage = search.locator('.trace-passages li').first()
    await expect(passage).toContainText('[1] Zápis z 9. zasedání zastupitelstva')
    await expect(passage).toContainText('strana 2')
    await expect(passage).toContainText('slova: 1, význam: 1')
    await expect(passage).toContainText('po RRF 1., reranker: 0,75')
    await passage.locator('summary').click()
    await expect(passage).toContainText('výměnu veřejného osvětlení v ulici Zahradní')

    await expect(steps.nth(2)).toContainText('Krok 1: volání modelu')
    await expect(steps.nth(2)).toContainText('fake:chat')
    await expect(steps.nth(2)).toContainText('Elektro Haná')
    await expect(steps.nth(2)).not.toContainText('Model žádá hledání')
    await expect(trace).toContainText('Odpověď návštěvníkovi')

    await trace.getByText('Nastavení a zadání, se kterým otázka běžela').click()
    const setup = trace.locator('.trace-setup')
    await expect(setup).toContainText('maxSearches')
    await expect(setup).toContainText('fake:decision')
    await expect(setup).toContainText('fake:rewrite')
    await expect(setup).toContainText('hledej_v_archivu')
    // The glossary goes to both: the rewrite, and the answer that may search again.
    const rewriteText = setup.locator('h4', { hasText: 'Zadání pro přeformulování otázky' })
    await expect(rewriteText.locator('+ p')).toContainText('Skill: Glosář archivu')
    await expect(rewriteText.locator('+ p')).toContainText('Skill: Přeformulování otázky')
    const answerText = setup.locator('h4', { hasText: 'Zadání pro odpověď' })
    await expect(answerText.locator('+ p')).toContainText(
      'Úřad píše o věcech jinými slovy než návštěvník',
    )
  })

  test('Výpočet je v postupu otázky se skriptem, parametry a výsledkem', async ({ page }) => {
    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await tryQuestion(page, SUM)

    // The rewrite and the first search, a step that asks for the calculation, the calculation, the answer.
    const trace = questionTraces(page).first()
    const steps = trace.locator('.trace-step')
    await expect(steps).toHaveCount(5)
    await expect(steps.nth(2)).toContainText('Krok 1: volání modelu')
    await expect(steps.nth(2)).toContainText('Model žádá výpočet: 1×')
    const calculation = steps.nth(3)
    await expect(calculation).toContainText('Výpočet')
    await expect(calculation).toContainText('parametry.castky.reduce')
    await expect(calculation.locator('pre').nth(1)).toContainText('870000')
    await expect(calculation.locator('pre').nth(1)).toContainText('240000')
    await expect(calculation.locator('pre').nth(2)).toHaveText('1110000')
    await expect(calculation).toContainText('započítaný výpočet')
    await expect(steps.nth(4)).toContainText('Krok 2: volání modelu')
    await expect(steps.nth(4)).toContainText('Celkem 1 110 000 Kč')
    // The first call has nothing to read from the cache; the next one sends the same start again.
    await expect(steps.nth(2)).toContainText('1 000 tokenů dovnitř, 100 ven')
    await expect(steps.nth(4)).toContainText('1 000 tokenů dovnitř, z toho 800 z cache, 100 ven')

    await trace.getByText('Nastavení a zadání, se kterým otázka běžela').click()
    await expect(trace.locator('.trace-setup')).toContainText('maxCalculations')
    await expect(trace.locator('.trace-setup')).toContainText('maxErroredRuns')
    await expect(trace.locator('.trace-setup')).toContainText('spocitej')
  })

  test('Skript s chybou se do výpočtů nezapočítá a model ho opraví', async ({ page }) => {
    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await tryQuestion(page, `${SUM} chybny skript`)

    const calculations = questionTraces(page).first().locator('.trace-step--calculation')
    await expect(calculations).toHaveCount(2)
    await expect(calculations.nth(0)).toContainText('Chyba skriptu: SyntaxError')
    await expect(calculations.nth(0)).toContainText('nezapočítaný výpočet')
    await expect(calculations.nth(1).locator('pre').nth(2)).toHaveText('1110000')
    await expect(calculations.nth(1)).toContainText('započítaný výpočet')
    await expect(calculations.nth(1)).not.toContainText('nezapočítaný')
  })

  test('Otázka návštěvníka je v ladění a její cena v nákladech', async ({ page }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST, 'Kolik?')

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(sessionRows(page)).toContainText('Otázek: 2')
    await page.getByRole('button', { name: `Otevřít rozhovor: ${FIRST}` }).click()
    // The follow-up found nothing by its own words and searched again with the first question.
    const followUp = questionTrace(page, 'Kolik?')
    await expect(followUp.locator('summary').first()).toContainText('Hledání: 2')
    await openQuestion(page, 'Kolik?')
    await expect(followUp).toContainText('Hledání: „Kdo vymění veřejné osvětlení? Kolik?“')

    // What the question cost is in the costs, under the models that answered it.
    await openAdminPage(page, 'Náklady')
    await expect(page.getByRole('row').filter({ hasText: 'fake:chat' }).first()).toBeVisible()
  })

  test('Dvě otázky jednoho chatu jsou jeden rozhovor', async ({ page, context }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST, 'Kolik?')

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(sessionRows(page).locator('.session__title')).toHaveText(FIRST)
    await expect(sessionRows(page)).toContainText('Otázek: 2')

    await page.getByRole('button', { name: `Otevřít rozhovor: ${FIRST}` }).click()
    await expect(page.getByRole('heading', { name: 'Rozhovor' })).toBeVisible()
    const id = await sessionView(page).locator('.trace-session__id code').textContent()
    expect(id).toMatch(UUID)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: 'Kopírovat id' }).click()
    await expect(page.getByRole('button', { name: 'Zkopírováno' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id)

    const summaries = questionTraces(page).locator(':scope > details > summary')
    await expect(summaries).toHaveCount(2)
    await expect(summaries.nth(0)).toContainText(FIRST)
    await expect(summaries.nth(1)).toContainText('Kolik?')
  })

  test('Druhá otázka ukazuje historii, kterou model dostal', async ({ page }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST, 'Kolik?')

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await page.getByRole('button', { name: `Otevřít rozhovor: ${FIRST}` }).click()
    await openQuestion(page, 'Kolik?')
    const turns = historyBlock(page, 'Kolik?').locator('.trace-history li')
    await expect(turns).toHaveCount(2)
    await expect(turns.nth(0)).toContainText('Návštěvník')
    await expect(turns.nth(0)).toContainText(FIRST)
    await expect(turns.nth(1)).toContainText('Archiv')
    await expect(turns.nth(1)).toContainText('Elektro Haná')

    await openQuestion(page, FIRST)
    await expect(historyBlock(page, FIRST)).toContainText('Model nedostal žádnou historii')
  })

  test('Správce pokračuje v rozhovoru zkušební otázkou', async ({ page }) => {
    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await tryQuestion(page, FIRST)
    await expect(page.getByRole('heading', { name: 'Rozhovor' })).toBeVisible()
    await expect(page.getByText('Zkušební otázka naváže na otevřený rozhovor.')).toBeVisible()

    await tryQuestion(page, 'Kolik?')
    await expect(questionTraces(page)).toHaveCount(2)
    const followUp = questionTrace(page, 'Kolik?')
    await expect(followUp.locator('summary').first()).toContainText('Hledání: 2')
    await expect(historyBlock(page, 'Kolik?').locator('.trace-history li')).toHaveCount(2)
    await expect(historyBlock(page, 'Kolik?')).toContainText(FIRST)
  })

  test('„Nový rozhovor“ začne nový rozhovor', async ({ page }) => {
    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await tryQuestion(page, FIRST)
    await expect(page.getByRole('heading', { name: 'Rozhovor' })).toBeVisible()

    await page.getByRole('button', { name: 'Nový rozhovor' }).click()
    await expect(page.getByRole('heading', { name: 'Rozhovor' })).toHaveCount(0)
    await expect(sessionRows(page)).toHaveCount(1)

    await tryQuestion(page, 'Kolik?')
    await expect(questionTraces(page)).toHaveCount(1)
    await expect(questionTrace(page, 'Kolik?').locator('summary').first()).toContainText(
      'Hledání: 1',
    )
    await expect(historyBlock(page, 'Kolik?')).toContainText('Model nedostal žádnou historii')

    await page.getByRole('button', { name: 'Nový rozhovor' }).click()
    await expect(sessionRows(page)).toHaveCount(2)
    await expect(sessionRows(page).first().locator('.session__title')).toHaveText('Kolik?')
  })

  test('Otázka se známým id rozhovoru naváže na rozhovor a historii dodá server', async ({
    page,
  }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST)

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await page.getByRole('button', { name: `Otevřít rozhovor: ${FIRST}` }).click()
    await expect(questionTraces(page)).toHaveCount(1)
    // The administrator's page sent only the session id; the history came from the server.
    await tryQuestion(page, 'Kolik?')
    await expect(questionTraces(page)).toHaveCount(2)
    const followUp = questionTrace(page, 'Kolik?')
    await expect(followUp.locator('summary').first()).toContainText('Hledání: 2')
    const turns = historyBlock(page, 'Kolik?').locator('.trace-history li')
    await expect(turns).toHaveCount(2)
    await expect(turns.nth(0)).toContainText(FIRST)
    await expect(turns.nth(1)).toContainText('Elektro Haná')
  })

  test('Otázka s neznámým id rozhovoru začne nový rozhovor', async ({ page }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST)
    const [forgotten] = await chatSessionIds()
    expect(forgotten).toMatch(UUID)
    await forgetChatTraces()

    // The panel still sends the old id; the server knows no such session and starts another.
    await visitorAsks(page, 'Kolik?')
    const remaining = await chatSessionIds()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).not.toBe(forgotten)

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(sessionRows(page)).toContainText('Otázek: 1')
    await page.getByRole('button', { name: 'Otevřít rozhovor: Kolik?' }).click()
    await expect(sessionView(page).locator('.trace-session__id code')).toHaveText(
      remaining[0] ?? '',
    )
    await expect(questionTraces(page)).toHaveCount(1)
    await expect(questionTrace(page, 'Kolik?').locator('summary').first()).toContainText(
      'Hledání: 1',
    )
    await openQuestion(page, 'Kolik?')
    await expect(historyBlock(page, 'Kolik?')).toContainText('Model nedostal žádnou historii')
  })

  test('Neúspěšná otázka není v historii další otázky', async ({ page }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST, 'selhani', 'Kolik?')

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(sessionRows(page)).toContainText('Otázek: 3')
    await expect(sessionRows(page).locator('.status--failed')).toBeVisible()
    await page.getByRole('button', { name: `Otevřít rozhovor: ${FIRST}` }).click()
    await expect(questionTraces(page)).toHaveCount(3)

    await openQuestion(page, 'Kolik?')
    const history = historyBlock(page, 'Kolik?')
    await expect(history.locator('.trace-history li')).toHaveCount(2)
    await expect(history).toContainText(FIRST)
    await expect(history).not.toContainText('selhani')
  })

  test('Otázka s hodnocením má štítek a rozhovor ukazuje počty hodnocení', async ({ page }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST)
    await visitorRates(page, 'Odpověď pomohla')
    await visitorAsks(page, 'Kolik?')
    await visitorRates(page, 'Odpověď nepomohla')
    await visitorAsks(page, 'Co je ve 4/2025?')

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(feedbackLabels(sessionRows(page))).toHaveText(['Pomohla: 1', 'Nepomohla: 1'])

    await page.getByRole('button', { name: `Otevřít rozhovor: ${FIRST}` }).click()
    await expect(questionTraces(page)).toHaveCount(3)
    const label = (question: string) =>
      feedbackLabels(questionTrace(page, question).locator('summary').first())
    await expect(label(FIRST)).toHaveText('Pomohla')
    await expect(label('Kolik?')).toHaveText('Nepomohla')
    await expect(label('Co je ve 4/2025?')).toHaveCount(0)
  })

  test('Filtr ukáže jen rozhovory s hodnocením, jen s kladným, nebo jen se záporným', async ({
    page,
  }) => {
    const UNRATED = 'Otevírací doba zoologické zahrady'
    await page.goto('/')
    await visitorAsks(page, FIRST)
    await visitorRates(page, 'Odpověď pomohla')
    await visitorStartsNewChat(page)
    await visitorAsks(page, 'Kolik?')
    await visitorRates(page, 'Odpověď nepomohla')
    await visitorStartsNewChat(page)
    await visitorAsks(page, UNRATED)

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await expect(filterChoice(page, 'Vše')).toHaveAttribute('aria-pressed', 'true')
    // The session asked in last is the first of the list.
    await expect(sessionTitles(page)).toHaveText([UNRATED, 'Kolik?', FIRST])

    await filterChoice(page, 'S hodnocením').click()
    await expect(filterChoice(page, 'S hodnocením')).toHaveAttribute('aria-pressed', 'true')
    await expect(filterChoice(page, 'Vše')).toHaveAttribute('aria-pressed', 'false')
    await expect(sessionTitles(page)).toHaveText(['Kolik?', FIRST])

    await filterChoice(page, 'Kladné').click()
    await expect(sessionTitles(page)).toHaveText([FIRST])
    await expect(feedbackLabels(sessionRows(page))).toHaveText(['Pomohla: 1'])

    await filterChoice(page, 'Záporné').click()
    await expect(sessionTitles(page)).toHaveText(['Kolik?'])
    await expect(feedbackLabels(sessionRows(page))).toHaveText(['Nepomohla: 1'])

    await filterChoice(page, 'Vše').click()
    await expect(sessionTitles(page)).toHaveText([UNRATED, 'Kolik?', FIRST])
  })

  test('Rozhovor s kladným i záporným hodnocením je v obou filtrech', async ({ page }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST)
    await visitorRates(page, 'Odpověď pomohla')
    await visitorAsks(page, 'Kolik?')
    await visitorRates(page, 'Odpověď nepomohla')

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await filterChoice(page, 'Kladné').click()
    await expect(filterChoice(page, 'Kladné')).toHaveAttribute('aria-pressed', 'true')
    await expect(sessionTitles(page)).toHaveText([FIRST])
    await filterChoice(page, 'Záporné').click()
    await expect(filterChoice(page, 'Záporné')).toHaveAttribute('aria-pressed', 'true')
    await expect(sessionTitles(page)).toHaveText([FIRST])
  })

  test('Filtr zůstane po novém načtení stránky', async ({ page }) => {
    await page.goto('/')
    await visitorAsks(page, FIRST)
    await visitorRates(page, 'Odpověď pomohla')

    await signIn(page)
    await openAdminPage(page, 'Ladění chatu')
    await filterChoice(page, 'Záporné').click()
    await expect(page.getByText('Žádný rozhovor s tímto hodnocením.')).toBeVisible()
    await expect(page).toHaveURL(/\/sprava\/chat\?hodnoceni=zaporne$/)

    await page.reload()
    await expect(filterChoice(page, 'Záporné')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Žádný rozhovor s tímto hodnocením.')).toBeVisible()

    await filterChoice(page, 'Kladné').click()
    await expect(sessionTitles(page)).toHaveText([FIRST])
  })
})
