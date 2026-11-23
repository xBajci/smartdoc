import { expect, test, type Page } from '@playwright/test'
import {
  chatFeedback,
  chatMlflowTraceIds,
  forgetChatTraces,
  resetArchive,
  useUpChatAllowance,
} from '../support/database'
import { MLFLOW_AUTHORIZATION, MLFLOW_EXPERIMENT_ID } from '../support/environment'
import { clearMlflowRecords, mlflowRecords } from '../support/mlflow'

// Scenarios: features/public/chat.feature
test.describe('Chat nad archivem', () => {
  test.beforeEach(async ({ page }) => {
    await resetArchive()
    await page.goto('/')
  })

  const chat = (page: Page) => page.getByRole('complementary', { name: 'Chat nad archivem' })
  const answers = (page: Page) => chat(page).locator('.chat-message--archive')

  async function ask(page: Page, question: string) {
    const input = chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })
    await input.fill(question)
    await input.press('Enter')
    await expect(chat(page).locator('.chat-message--pending')).toHaveCount(0)
  }

  /** The two buttons under an answer that say whether it helped. */
  const feedback = (page: Page, answer = 0) =>
    answers(page).nth(answer).getByRole('group', { name: 'Hodnocení odpovědi' })
  const rate = (page: Page, name: 'Odpověď pomohla' | 'Odpověď nepomohla', answer = 0) =>
    feedback(page, answer).getByRole('button', { name, exact: true })

  test('Panel chatu je vedle seznamu dokumentů', async ({ page }) => {
    await expect(chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })).toBeVisible()
    // The scope shows only when the visitor chose documents to ask about.
    await expect(chat(page)).not.toContainText('Chat prohledá')
    await expect(
      chat(page).getByPlaceholder('Např. Jaký je koeficient zastavěnosti na území obce?'),
    ).toBeVisible()
    await expect(chat(page).getByRole('heading')).toHaveText(['Můžete začít třeba takto'])
    await expect(chat(page)).toContainText('Můžete začít třeba takto')
    await expect(chat(page).getByRole('button', { name: 'Zeptat se', exact: true })).toBeDisabled()
    const list = await page.locator('.lib-card').boundingBox()
    const panel = await chat(page).boundingBox()
    expect(panel?.x).toBeGreaterThan((list?.x ?? 0) + (list?.width ?? 0))
  })

  test('Odpověď vychází z dokumentů a uvádí zdroj se stranou', async ({ page }) => {
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(chat(page)).toContainText('Kdo vymění veřejné osvětlení?')
    await expect(answers(page)).toContainText('Práce provede firma Elektro Haná za 870 000 Kč')
    await expect(chat(page).locator('.chat-reference')).toHaveText(['[1]'])
    const sources = chat(page).locator('.chat-sources li')
    await expect(sources).toHaveCount(1)
    await expect(sources).toContainText('Zápis z 9. zasedání zastupitelstva · str. 2')
    await expect(chat(page)).toContainText('Odpověď si ověřte v uvedených zdrojích.')
    await expect(chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })).toHaveValue('')
  })

  test('Během hledání chat ukazuje, co právě dělá', async ({ page }) => {
    // The suite turns motion off; the running dots need it on.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    // Some steps show for a moment only, so the page writes down every text the step had.
    await page.evaluate(() => {
      const seen: string[] = []
      Object.assign(window, { progressSeen: seen })
      new MutationObserver(() => {
        const text = document.querySelector('.chat-progress')?.textContent
        if (text !== undefined && seen.at(-1) !== text) seen.push(text)
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    // The fake model reads every search a while when the question asks it to.
    const input = chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })
    await input.fill('Kdo vymění veřejné osvětlení? (pomalu)')
    await input.press('Enter')
    const progress = chat(page).locator('.chat-progress')
    await expect(progress).toHaveCount(1)
    await expect(progress).toHaveCount(0)
    const seen = await page.evaluate(
      () => (window as unknown as { progressSeen: string[] }).progressSeen,
    )
    // One step at a time, each new one in place of the last.
    expect([...new Set(seen.map((text) => text.replace(/[.…]+$/, '')))]).toEqual([
      'Přemýšlím nad otázkou',
      'Prohledávám dokumenty',
      'Řadím výsledky',
      'Analyzuji výsledky',
      'Ještě poslední kontrola',
      'Přidávám zdroje',
    ])
    // A step that takes long gets running dots.
    for (const text of [
      'Analyzuji výsledky…',
      'Analyzuji výsledky.',
      'Analyzuji výsledky..',
      'Analyzuji výsledky...',
    ]) {
      expect(seen).toContain(text)
    }
    await expect(answers(page)).toContainText('Práce provede firma Elektro Haná za 870 000 Kč')
    await expect(chat(page).locator('.chat-sources li')).toHaveCount(1)
  })

  test('Otázka na výpočet dostane spočítaný výsledek se zdroji, bez skriptu', async ({ page }) => {
    await ask(page, 'Kolik obec dá celkem za osvětlení a dotace spolkům?')
    await expect(answers(page)).toContainText('Celkem 1 110 000 Kč')
    await expect(chat(page).locator('.chat-reference')).toHaveText(['[1]', '[2]'])
    const sources = chat(page).locator('.chat-sources li')
    await expect(sources).toHaveCount(2)
    // Both pages of the minutes, in the order the answer cites them.
    await expect(
      sources.filter({ hasText: 'Zápis z 9. zasedání zastupitelstva · str. 2' }),
    ).toHaveCount(1)
    await expect(
      sources.filter({ hasText: 'Zápis z 9. zasedání zastupitelstva · str. 3' }),
    ).toHaveCount(1)
    await expect(answers(page)).not.toContainText('parametry')
    await expect(answers(page)).not.toContainText('return')
  })

  test('Zdroj otevře dokument na uvedené straně a chat zůstane', async ({ page }) => {
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await chat(page)
      .getByRole('button', { name: 'Otevřít: Zápis z 9. zasedání zastupitelstva' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Zápis z 9. zasedání zastupitelstva' }),
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Strana', exact: true })).toHaveValue('2')
    await expect(answers(page)).toContainText('Elektro Haná')
  })

  test('Číslo s lomítkem najde dokument, který ho obsahuje', async ({ page }) => {
    // The text keeps "4/2025" as one word, so the question must too. Split
    // into "4" and "2025" it finds the contract, which names the year more often.
    await ask(page, 'Co je ve 4/2025?')
    await expect(answers(page)).toContainText('Podle dokumentu „Zpravodaj 4/2025“')
  })

  test('Když v archivu odpověď není, chat to řekne a neuvede zdroj', async ({ page }) => {
    await ask(page, 'Otevírací doba zoologické zahrady')
    await expect(answers(page)).toContainText('V archivu jsem k tomu nic nenašel.')
    await expect(chat(page).locator('.chat-sources')).toHaveCount(0)
  })

  test('Navazující otázka použije předchozí konverzaci', async ({ page }) => {
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await ask(page, 'Kolik?')
    await expect(answers(page)).toHaveCount(2)
    await expect(answers(page).last()).toContainText('870 000 Kč')
    await expect(answers(page).last()).toContainText('Zápis z 9. zasedání zastupitelstva')
  })

  test('„Nový chat“ začne konverzaci od začátku', async ({ page }) => {
    const startAgain = chat(page).getByRole('button', { name: 'Nový chat' })
    await expect(startAgain).toHaveCount(0)
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page)).toContainText('870 000 Kč')

    await startAgain.click()
    await expect(chat(page).locator('.chat-message')).toHaveCount(0)
    await expect(chat(page)).toContainText('Můžete začít třeba takto')
    await expect(chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })).toBeFocused()
    await expect(startAgain).toHaveCount(0)

    // The same question that continued the conversation before now stands alone.
    await ask(page, 'Kolik?')
    await expect(answers(page)).toHaveCount(1)
    await expect(answers(page)).not.toContainText('870 000 Kč')
  })

  test('Hodnocení je pod každou odpovědí, pod hlášením chyby není', async ({ page }) => {
    await ask(page, 'selhani')
    await expect(answers(page)).toContainText('Odpověď se nepodařilo získat.')
    await expect(chat(page).getByRole('group', { name: 'Hodnocení odpovědi' })).toHaveCount(0)

    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await ask(page, 'Kolik?')
    // The message of the failure is the first of the three; it stays without buttons.
    await expect(chat(page).getByRole('group', { name: 'Hodnocení odpovědi' })).toHaveCount(2)
    for (const answer of [1, 2]) {
      await expect(rate(page, 'Odpověď pomohla', answer)).toHaveAttribute('aria-pressed', 'false')
      await expect(rate(page, 'Odpověď nepomohla', answer)).toHaveAttribute('aria-pressed', 'false')
    }
  })

  test('Návštěvník ohodnotí odpověď a hodnocení může změnit', async ({ page }) => {
    const question = 'Kdo vymění veřejné osvětlení?'
    await ask(page, question)
    await rate(page, 'Odpověď pomohla').click()
    await expect(rate(page, 'Odpověď pomohla')).toHaveAttribute('aria-pressed', 'true')
    await expect(feedback(page).getByRole('status')).toHaveText('Děkujeme za hodnocení.')
    expect(await chatFeedback()).toEqual([{ question, helpful: true }])

    await rate(page, 'Odpověď nepomohla').click()
    await expect(rate(page, 'Odpověď nepomohla')).toHaveAttribute('aria-pressed', 'true')
    await expect(rate(page, 'Odpověď pomohla')).toHaveAttribute('aria-pressed', 'false')
    expect(await chatFeedback()).toEqual([{ question, helpful: false }])
  })

  test('Každá odpověď má své hodnocení', async ({ page }) => {
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await ask(page, 'Kolik?')
    await rate(page, 'Odpověď pomohla', 0).click()
    await expect(rate(page, 'Odpověď pomohla', 0)).toHaveAttribute('aria-pressed', 'true')
    await rate(page, 'Odpověď nepomohla', 1).click()
    await expect(rate(page, 'Odpověď nepomohla', 1)).toHaveAttribute('aria-pressed', 'true')

    await expect(rate(page, 'Odpověď nepomohla', 0)).toHaveAttribute('aria-pressed', 'false')
    await expect(rate(page, 'Odpověď pomohla', 1)).toHaveAttribute('aria-pressed', 'false')
    expect(await chatFeedback()).toEqual([
      { question: 'Kdo vymění veřejné osvětlení?', helpful: true },
      { question: 'Kolik?', helpful: false },
    ])
  })

  test('Hodnocení odpovědi, jejíž záznam byl smazán, se neuloží', async ({ page }) => {
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await forgetChatTraces()

    await rate(page, 'Odpověď pomohla').click()
    await expect(feedback(page).getByRole('status')).toHaveText('Hodnocení se nepodařilo uložit.')
    await expect(rate(page, 'Odpověď pomohla')).toHaveAttribute('aria-pressed', 'false')
    await expect(rate(page, 'Odpověď nepomohla')).toHaveAttribute('aria-pressed', 'false')
    expect(await chatFeedback()).toEqual([])
  })

  test('Otázka a její hodnocení dorazí do MLflow', async ({ page }) => {
    await clearMlflowRecords()
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    const [traceId] = await chatMlflowTraceIds()
    expect(traceId).toMatch(/^tr-[0-9a-f]{32}$/)
    // OTLP carries the trace id as its 16 bytes, which the stand-in keeps in hex.
    const traceBytes = traceId?.slice('tr-'.length) ?? ''
    await expect
      .poll(async () =>
        (await mlflowRecords()).some(
          (record) =>
            record.kind === 'trace' &&
            record.body.includes(traceBytes) &&
            record.experimentId === MLFLOW_EXPERIMENT_ID &&
            record.authorization === MLFLOW_AUTHORIZATION,
        ),
      )
      .toBe(true)
    // The search is a retriever step with the pieces it found, which the judges of MLflow read.
    const hex = (text: string) => Buffer.from(text).toString('hex')
    await expect
      .poll(async () =>
        (await mlflowRecords()).some(
          (record) =>
            record.kind === 'trace' &&
            record.body.includes(traceBytes) &&
            record.body.includes(hex('RETRIEVER')) &&
            record.body.includes(hex('page_content')),
        ),
      )
      .toBe(true)

    /** What MLflow got about the visitor's word, oldest first. */
    const feedback = async () =>
      (await mlflowRecords())
        .filter((record) => record.kind !== 'trace')
        .map((record) => ({
          kind: record.kind,
          traceId: record.traceId,
          feedbackId: record.feedbackId,
          authorization: record.authorization,
          ...(JSON.parse(record.body) as object),
        }))

    await rate(page, 'Odpověď nepomohla').click()
    await expect(rate(page, 'Odpověď nepomohla')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(feedback).toEqual([
      {
        kind: 'feedback',
        traceId,
        feedbackId: null,
        authorization: MLFLOW_AUTHORIZATION,
        assessment: {
          trace_id: traceId,
          assessment_name: 'helpful',
          source: { source_type: 'HUMAN', source_id: expect.any(String) },
          feedback: { value: false },
        },
      },
    ])

    // The same word again changes nothing; another word changes the one feedback.
    await rate(page, 'Odpověď nepomohla').click()
    await expect(rate(page, 'Odpověď pomohla')).toBeEnabled()
    await rate(page, 'Odpověď pomohla').click()
    await expect(rate(page, 'Odpověď pomohla')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await feedback()).length).toBe(2)
    const [created, changed] = await feedback()
    expect(changed).toEqual({
      kind: 'feedback-update',
      traceId,
      feedbackId: expect.stringMatching(/^a-\d+$/),
      authorization: MLFLOW_AUTHORIZATION,
      assessment: {
        assessment_id: changed?.feedbackId,
        trace_id: traceId,
        feedback: { value: true },
      },
      update_mask: 'feedback',
    })
    expect(created?.kind).toBe('feedback')
  })

  test('Po vyčerpání denního počtu otázek chat otázku nepřijme', async ({ page }) => {
    await useUpChatAllowance(50)
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page)).toContainText(
      'Chat má pro dnešek vyčerpaný počet otázek. Zkuste to zítra.',
    )
    await expect(chat(page).locator('.chat-sources')).toHaveCount(0)
  })

  test('Chyba při odpovědi se ohlásí a další otázka projde', async ({ page }) => {
    await ask(page, 'selhani')
    await expect(answers(page)).toContainText(
      'Odpověď se nepodařilo získat. Zkuste to prosím znovu.',
    )
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page).last()).toContainText('Elektro Haná')
  })

  test('Na úzké obrazovce se chat otevírá tlačítkem', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 800 })
    await expect(chat(page)).toBeHidden()
    await page.getByRole('button', { name: 'Zeptat se archivu' }).click()
    await expect(chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })).toBeVisible()
    await chat(page).getByRole('button', { name: 'Zavřít chat' }).click()
    await expect(chat(page)).toBeHidden()
    await expect(page.getByRole('searchbox')).toBeVisible()
  })

  test('„Zeptat se na dokument“ omezí odpověď na vybrané dokumenty', async ({ page }) => {
    const choose = async (title: string) => {
      const row = page.locator('.doc-row').filter({ hasText: title })
      await row.getByRole('button', { name: /Zeptat se na dokument/ }).click()
      await expect(row.getByRole('button', { name: /Vybráno pro otázku/ })).toBeVisible()
    }
    // Both documents of this test are on the first page when the list is by the day of adding.
    await page.goto('/?razeni=nove')
    const chosen = chat(page).getByRole('list', { name: 'Vybrané dokumenty' })
    const input = chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })

    await choose('Kostel od polní cesty')
    await expect(chat(page)).toContainText('Chat prohledá jen vybrané dokumenty (1)')
    await expect(chosen.getByRole('listitem')).toHaveText(['Kostel od polní cesty'])
    await expect(input).toBeFocused()
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page).last()).toContainText('nic nenašel')

    await choose('Zápis z 9. zasedání zastupitelstva')
    await expect(chat(page)).toContainText('Chat prohledá jen vybrané dokumenty (2)')
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page).last()).toContainText('Elektro Haná')

    // The bin takes a document out; with none left the whole archive is searched again.
    await chosen
      .getByRole('button', { name: 'Odebrat z výběru: Zápis z 9. zasedání zastupitelstva' })
      .click()
    await expect(chat(page)).toContainText('Chat prohledá jen vybrané dokumenty (1)')
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page).last()).toContainText('nic nenašel')
    await chosen.getByRole('button', { name: 'Odebrat z výběru: Kostel od polní cesty' }).click()
    await expect(chat(page)).not.toContainText('Chat prohledá')
    await expect(chosen).toHaveCount(0)
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page).last()).toContainText('Elektro Haná')

    // "Odebrat vše" empties the choice in one step.
    await choose('Kostel od polní cesty')
    await choose('Zápis z 9. zasedání zastupitelstva')
    await chat(page).getByRole('button', { name: 'Odebrat vše' }).click()
    await expect(chosen).toHaveCount(0)
    await expect(chat(page)).not.toContainText('Chat prohledá')
    await expect(page.getByRole('button', { name: /Vybráno pro otázku/ })).toHaveCount(0)
  })

  test('Otevřený dokument lze vybrat pro otázku přímo v prohlížeči', async ({ page }) => {
    const title = 'Schválený rozpočet na rok 2025'
    const viewer = page.getByRole('region', { name: title })
    const chosen = chat(page).getByRole('list', { name: 'Vybrané dokumenty' })

    await page.locator('.document-link', { hasText: title }).click()
    await expect(chat(page)).not.toContainText('Chat prohledá')
    await viewer.getByRole('button', { name: 'Zeptat se na dokument' }).click()
    await expect(chat(page)).toContainText('Chat prohledá jen vybrané dokumenty (1)')
    await expect(chosen.getByRole('listitem')).toHaveText([title])
    await expect(viewer.getByRole('button', { name: 'Vybráno pro otázku' })).toBeVisible()
    await ask(page, 'Kdo vymění veřejné osvětlení?')
    await expect(answers(page).last()).toContainText('nic nenašel')

    // The list and the viewer show the same choice.
    await viewer.getByRole('button', { name: 'Zpět na seznam' }).click()
    await expect(page.getByRole('button', { name: `Vybráno pro otázku: ${title}` })).toBeVisible()

    await page.locator('.document-link', { hasText: title }).click()
    await viewer.getByRole('button', { name: 'Vybráno pro otázku' }).click()
    await expect(chat(page)).not.toContainText('Chat prohledá')
    await expect(chosen).toHaveCount(0)
  })
})
