import { expect, test, type Page } from '@playwright/test'
import { resetArchive } from '../support/database'

/** Marks the page as it is loaded now, so a test can tell when the browser loaded it again. */
async function markLoaded(page: Page) {
  await page.evaluate(() => {
    ;(window as { loadedBefore?: boolean }).loadedBefore = true
  })
}

/** Whether the browser loaded the page again since `markLoaded`. */
async function loadedAgain(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => (window as { loadedBefore?: boolean }).loadedBefore !== true)
  } catch {
    // The page is between two loads right now.
    return false
  }
}

/**
 * Makes the server fail every call of a server function while `failing()`
 * says so. The answer is the one the server gives a tab of an older build
 * that calls a function the new build does not know.
 */
async function failServerFunctions(page: Page, failing: () => boolean) {
  await page.route('**/_serverFn/**', (route) =>
    failing()
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"status":500,"unhandled":true,"message":"HTTPError"}',
        })
      : route.continue(),
  )
}

/** How often the browser asked for the page itself; the first load is one. */
function countLoads(page: Page) {
  const loads = { count: 0 }
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads.count += 1
  })
  return loads
}

async function expectSearchResults(page: Page) {
  await expect(page.getByRole('searchbox')).toHaveValue('rozpočet')
  await expect(page.locator('.document-link').first()).toContainText('rozpočet', {
    ignoreCase: true,
  })
  await expect(page.getByText('Archiv se nepodařilo načíst')).toHaveCount(0)
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'Chat nad archivem' })

async function ask(page: Page, question: string) {
  const input = chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })
  await input.fill(question)
  await input.press('Enter')
}

// Scenarios: features/public/nova-verze.feature
test.describe('Stránka po chybě a po nasazení nové verze', () => {
  test.beforeEach(resetArchive)

  test('Běžné procházení stránku znovu nenačítá', async ({ page }) => {
    const versionRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/verze')) versionRequests.push(request.url())
    })
    await page.goto('/')
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    await markLoaded(page)

    await page.getByRole('searchbox').fill('rozpočet')
    await expect(page.locator('.document-link').first()).toContainText('rozpočet', {
      ignoreCase: true,
    })
    await page.locator('.account summary').click()
    await page.getByRole('link', { name: 'Přihlásit se' }).click()
    await expect(page.getByLabel('Heslo')).toBeVisible()

    expect(await loadedAgain(page)).toBe(false)
    expect(versionRequests).toEqual([])
  })

  test('Karta se starou verzí se po nasazení sama načte znovu', async ({ page }) => {
    const loads = countLoads(page)
    await page.goto('/')
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    await markLoaded(page)

    // The new server runs another build and does not know the functions of this tab.
    await page.route('**/api/verze', (route) => route.fulfill({ json: { id: 'nova-verze' } }))
    // The tab that loads next is of the new build, and the server answers it.
    await failServerFunctions(page, () => loads.count === 1)

    await page.getByRole('searchbox').fill('rozpočet')

    await expect.poll(() => loadedAgain(page)).toBe(true)
    await expectSearchResults(page)
    expect(loads.count).toBe(2)
  })

  test('Otázka do chatu ze staré karty načte stránku znovu', async ({ page }) => {
    const loads = countLoads(page)
    await page.goto('/')
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    await markLoaded(page)

    await page.route('**/api/verze', (route) => route.fulfill({ json: { id: 'nova-verze' } }))
    await failServerFunctions(page, () => loads.count === 1)

    await ask(page, 'Kdo vymění veřejné osvětlení?')

    await expect.poll(() => loadedAgain(page)).toBe(true)
    await expect(chat(page).getByRole('textbox', { name: 'Otázka pro archiv' })).toBeVisible()
    await expect(chat(page).getByText('Odpověď se nepodařilo získat.')).toHaveCount(0)
    expect(loads.count).toBe(2)
  })

  test('Chyba chatu ve stejné verzi stránku znovu nenačítá', async ({ page }) => {
    let failing = false
    await failServerFunctions(page, () => failing)
    await page.goto('/')
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    await markLoaded(page)

    failing = true
    await ask(page, 'Kdo vymění veřejné osvětlení?')

    // The server runs the build of this tab, so the failure is the chat's own to tell.
    await expect(chat(page).locator('.chat-message--archive')).toContainText(
      'Odpověď se nepodařilo získat.',
    )
    expect(await loadedAgain(page)).toBe(false)
  })

  test('Chyba stránky ji načte znovu, místo aby se ukázala', async ({ page }) => {
    const loads = countLoads(page)
    await page.goto('/')
    await expect(page.getByText('12 dokumentů')).toBeVisible()
    await markLoaded(page)

    // The server runs the build of this tab; only this one page fails.
    await failServerFunctions(page, () => loads.count === 1)

    await page.getByRole('searchbox').fill('rozpočet')

    await expect.poll(() => loadedAgain(page)).toBe(true)
    await expectSearchResults(page)
    expect(loads.count).toBe(2)
  })

  test('Když chyba trvá i po novém načtení, stránka to řekne a nabídne další pokus', async ({
    page,
  }) => {
    const loads = countLoads(page)
    let failing = false
    await failServerFunctions(page, () => failing)
    await page.goto('/')
    await expect(page.getByText('12 dokumentů')).toBeVisible()

    failing = true
    await page.getByRole('searchbox').fill('rozpočet')

    const notice = page.getByRole('alert').filter({ hasText: 'Archiv se nepodařilo načíst' })
    await expect(notice).toBeVisible()
    // Loaded once at the start and once again for the failure; the second failure stays on the page.
    expect(loads.count).toBe(2)

    failing = false
    await notice.getByRole('button', { name: 'Načíst znovu' }).click()
    await expectSearchResults(page)
  })
})
