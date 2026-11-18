import { expect, test } from '@playwright/test'
import { signIn } from '../support/admin'
import { resetArchive } from '../support/database'
import { SITE_URL } from '../support/environment'
import { demoFile, uploadFiles } from '../support/upload'

/** The titles of the items of the feed, in their order. */
function itemTitles(xml: string): string[] {
  return [...xml.matchAll(/<item>\s*<title>([^<]*)<\/title>/g)].map((match) => match[1] ?? '')
}

// Scenarios: features/public/rss.feature
test.describe('RSS s novými dokumenty', () => {
  test.beforeEach(resetArchive)

  test('RSS obsahuje zveřejněné dokumenty od nejnověji přidaného', async ({ request }) => {
    const response = await request.get('/rss.xml')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/rss+xml')
    const xml = await response.text()
    expect(xml).toContain('<rss version="2.0"')

    const titles = itemTitles(xml)
    expect(titles).toHaveLength(12)
    expect(titles[0]).toBe('Zápis z 9. zasedání zastupitelstva')
    // A document that is not ready is not public.
    expect(titles).not.toContain('Zpravodaj 3/2025')

    const [first] = xml.split('<item>').slice(1)
    expect(first).toContain(`<link>${SITE_URL}/?doc=`)
    expect(first).toMatch(/<pubDate>\w{3}, \d{2} \w{3} 2026 [\d:]+ GMT<\/pubDate>/)
    expect(first).toMatch(/<category>[^<]+<\/category>/)
    expect(first).toMatch(/<description>[^<]+<\/description>/)
  })

  test('Odkazy v RSS vedou na veřejnou adresu webu', async ({ request, baseURL }) => {
    // The server is asked at its own address, yet every link carries the public one.
    expect(baseURL).not.toBe(SITE_URL)
    const xml = await (await request.get('/rss.xml')).text()

    expect(xml).toContain(`<link>${SITE_URL}/</link>`)
    expect(xml).toContain(`<atom:link href="${SITE_URL}/rss.xml" rel="self"`)
    const links = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]*)<\/link>/g)].map((match) => match[1])
    expect(links).toHaveLength(12)
    for (const link of links) expect(link).toMatch(new RegExp(`^${SITE_URL}/\\?doc=`))
    expect(xml).not.toContain('127.0.0.1')
  })

  test('Nově nahraný dokument se v RSS objeví jako první', async ({ page }) => {
    await signIn(page)
    await uploadFiles(page, [demoFile('projekt-cyklostezka.pdf', 'nova-studie.pdf')])
    const xml = await (await page.request.get('/rss.xml')).text()
    expect(itemTitles(xml)[0]).toBe('nova-studie (název z obsahu)')
  })

  test('Stránka na RSS odkazuje', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('head link[type="application/rss+xml"]')).toHaveAttribute(
      'href',
      '/rss.xml',
    )
    // One icon in the header, next to the account.
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Nové dokumenty (RSS)' }),
    ).toHaveAttribute('href', '/rss.xml')
  })
})
