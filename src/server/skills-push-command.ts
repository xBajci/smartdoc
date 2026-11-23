import { readdir, readFile } from 'node:fs/promises'
import { parseSkillFile } from './ai/skills/types'

/**
 * `pnpm skills:push <key>…` or `pnpm skills:push --all` — sends the texts of
 * starting skills from their files to the running application, where they are
 * in use at once. Name the skills you changed: `--all` also replaces what the
 * administrator edited in other skills.
 */
const FOLDER = 'src/server/ai/skills'
const GROUPS = ['zpracovani', 'chat']

// An empty SKILLS_API_URL, as in .env.example, means SITE_URL.
const url = (process.env.SKILLS_API_URL || process.env.SITE_URL || '').replace(/\/+$/, '')
const token = process.env.SKILLS_API_TOKEN ?? ''
if (url === '' || token === '') {
  console.error('Nastav SKILLS_API_URL (nebo SITE_URL) a SKILLS_API_TOKEN.')
  process.exit(1)
}
// The token must not travel unencrypted, except to this computer.
if (!/^https:|^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(url)) {
  console.error(`${url}: token posílám jen přes https (nebo na localhost).`)
  process.exit(1)
}

const args = process.argv.slice(2)
const keys = args.includes('--all')
  ? (
      await Promise.all(
        GROUPS.map(async (group) =>
          (await readdir(`${FOLDER}/${group}`))
            .filter((name) => name.endsWith('.md'))
            .map((name) => `${group}/${name.slice(0, -3)}`),
        ),
      )
    ).flat()
  : args
if (keys.length === 0) {
  console.error('Použití: pnpm skills:push <klíč>… (např. chat/system) nebo --all')
  process.exit(1)
}
const unknown = keys.find((key) => !/^(zpracovani|chat)\/[a-z0-9-]+$/.test(key))
if (unknown !== undefined) {
  console.error(`Neznámý skill „${unknown}“. Klíč je skupina/soubor, např. chat/system.`)
  process.exit(1)
}

const skills = await Promise.all(
  keys.map(async (key) => ({
    key,
    content: parseSkillFile(key, await readFile(`${FOLDER}/${key}.md`, 'utf8')).content,
  })),
)
const response = await fetch(`${url}/api/skills`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ skills }),
})
if (!response.ok) {
  console.error(`${url}: ${response.status} ${await response.text()}`)
  process.exit(1)
}
const result = (await response.json()) as { skills: { key: string; status: string }[] }
for (const skill of result.skills) {
  console.log(`${skill.key}: ${skill.status === 'updated' ? 'nahráno' : 'beze změny'}`)
}
