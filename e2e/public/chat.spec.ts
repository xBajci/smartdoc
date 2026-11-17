import { expect, test, type Page } from '@playwright/test'
import { resetArchive, useUpChatAllowance } from '../support/database'

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
