import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { openAdminPage, signIn } from '../support/admin'
import { resetArchive } from '../support/database'
import { SKILLS_API_TOKEN } from '../support/environment'

const run = promisify(execFile)
const SEARCH_SKILL = 'chat/hledani'
const EDITED = '- Hledej nejdřív v usneseních zastupitelstva. Zkušební text ze souboru.'

/** Sends skill texts the way `pnpm skills:push` does. */
function push(
  request: APIRequestContext,
  skills: { key: string; content: string }[],
  token: string | null = SKILLS_API_TOKEN,
) {
  return request.post('/api/skills', {
    data: { skills },
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })
}

/** The editor of "Hledání v archivu" in the administration. */
async function searchSkill(page: Page) {
  await signIn(page)
  await openAdminPage(page, 'Skilly')
  await page
    .getByRole('navigation', { name: 'Seznam skillů' })
    .locator('.skills-nav__item')
    .filter({ hasText: 'Hledání v archivu' })
    .click()
  const editor = page.getByRole('form', { name: 'Hledání v archivu' })
  await expect(editor).toBeVisible()
  return editor
}

// Scenarios: features/admin/skilly-ze-souboru.feature
test.describe('Skilly ze souborů: nahrání do běžící aplikace', () => {
  test.beforeEach(resetArchive)

  test('Aplikace přijme text skillu s platným tokenem', async ({ page, request }) => {
    const first = await push(request, [{ key: SEARCH_SKILL, content: EDITED }])
    expect(first.status()).toBe(200)
    expect(await first.json()).toEqual({ skills: [{ key: SEARCH_SKILL, status: 'updated' }] })

    const editor = await searchSkill(page)
    await expect(editor).toContainText('Verze 1')
    await expect(editor.getByLabel('Zadání')).toHaveValue(EDITED)

    const again = await push(request, [{ key: SEARCH_SKILL, content: EDITED }])
    expect(await again.json()).toEqual({ skills: [{ key: SEARCH_SKILL, status: 'unchanged' }] })
  })

  test('Bez platného tokenu aplikace nic nezmění', async ({ page, request }) => {
    const missing = await push(request, [{ key: SEARCH_SKILL, content: EDITED }], null)
    expect(missing.status()).toBe(401)
    expect(await missing.text()).toBe('Unauthorized')

    const wrong = await push(request, [{ key: SEARCH_SKILL, content: EDITED }], 'spatny-token')
    expect(wrong.status()).toBe(401)
    expect(await wrong.text()).toBe('Unauthorized')

    await expect(await searchSkill(page)).toContainText('Výchozí znění')
  })

  test('Aplikace odmítne skill, který není ze souboru', async ({ page, request }) => {
    const response = await push(request, [
      { key: SEARCH_SKILL, content: EDITED },
      { key: 'vlastni/tykani', content: 'Tykej návštěvníkům.' },
    ])
    expect(response.status()).toBe(400)

    // Nothing is saved when one of the texts is refused.
    await expect(await searchSkill(page)).toContainText('Výchozí znění')
  })

  test('Příkaz pnpm skills:push pošle text ze souboru', async ({ page, request, baseURL }) => {
    await push(request, [{ key: SEARCH_SKILL, content: EDITED }])

    const { stdout } = await run(
      'node_modules/.bin/tsx',
      ['src/server/skills-push-command.ts', SEARCH_SKILL],
      {
        env: { ...process.env, SKILLS_API_URL: baseURL, SKILLS_API_TOKEN },
      },
    )
    expect(stdout).toContain(`${SEARCH_SKILL}: nahráno`)

    const file = await readFile(`src/server/ai/skills/${SEARCH_SKILL}.md`, 'utf8')
    const editor = await searchSkill(page)
    await expect(editor).toContainText('Verze 2')
    await expect(editor.getByLabel('Zadání')).toHaveValue(
      file.replace(/^---\n[\s\S]*?\n---\n/, '').trim(),
    )
  })
})
