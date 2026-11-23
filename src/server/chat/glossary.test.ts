import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseSkillFile } from '../ai/skills'
import { GLOSSARY_FILE, GLOSSARY_SKILL, glossaryInput, glossarySkillFile } from './glossary'

// `pnpm glossary:build` needs a real model and the documents of the archive, so
// no E2E test runs it. These check what it sends and what file it writes.
describe('the glossary of the chat', () => {
  it('lists the documents oldest first, each on one line', () => {
    const input = glossaryInput([
      { title: 'Rozpočet 2025', description: 'Příjmy a výdaje.', category: 'Rozpočty', year: 2025 },
      { title: 'Zápis ZO', description: 'Kanalizace.', category: 'Zápisy', year: null },
      { title: 'Usnesení', description: 'Osvětlení.', category: 'Zápisy', year: 2019 },
    ])
    expect(input.split('\n')).toEqual([
      '- Zápis ZO (Zápisy, rok neznámý): Kanalizace.',
      '- Usnesení (Zápisy, 2019): Osvětlení.',
      '- Rozpočet 2025 (Rozpočty, 2025): Příjmy a výdaje.',
    ])
  })

  it('writes a skill file the application reads back as the glossary', () => {
    const skill = parseSkillFile(
      GLOSSARY_SKILL,
      glossarySkillFile('## Zkratky\n\n- OZV: vyhláška\n'),
    )
    expect(skill).toMatchObject({ key: GLOSSARY_SKILL, kind: 'skill', title: 'Glosář archivu' })
    expect(skill.uses).toEqual(['chat-rewrite', 'chat-answer'])
    expect(skill.content).toMatch(/^Úřad píše o věcech jinými slovy/)
    expect(skill.content).toMatch(/- OZV: vyhláška$/)
  })

  it('has the same head as the starting file, so a new extract keeps where it is attached', async () => {
    const file = await readFile(GLOSSARY_FILE, 'utf8')
    const head = (text: string) => text.split('\n---\n')[0]
    expect(head(glossarySkillFile('x'))).toBe(head(file))
  })
})
