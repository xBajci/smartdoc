import { describe, expect, it } from 'vitest'
import { defaultSkills, SKILLS } from './index'
import { instructionsFor, parseSkillFile, SKILL_USES } from './types'

describe('skills', () => {
  it('every group has exactly one system prompt', () => {
    for (const group of ['zpracovani', 'chat']) {
      expect(
        SKILLS.filter((skill) => skill.group === group && skill.kind === 'system'),
      ).toHaveLength(1)
    }
  })

  it('every skill has a name, a text and a place; every place has a skill', () => {
    for (const skill of SKILLS) {
      expect(skill.title).not.toBe('')
      expect(skill.content).not.toBe('')
      if (skill.kind === 'skill') expect(skill.uses.length).toBeGreaterThan(0)
    }
    // The choice of a category starts with no skill: what belongs to a category is written at the category.
    for (const { use } of SKILL_USES.filter((item) => item.use !== 'categorize')) {
      expect(SKILLS.some((skill) => skill.uses.includes(use))).toBe(true)
    }
  })

  it('attaches a skill only to places of its own group', () => {
    for (const skill of SKILLS) {
      for (const use of skill.uses) {
        expect(SKILL_USES.find((item) => item.use === use)?.group).toBe(skill.group)
      }
    }
  })
})

describe('parseSkillFile', () => {
  it('reads the head and the text of a Markdown file', () => {
    const skill = parseSkillFile(
      'zpracovani/pokus',
      '---\ntitle: Pokus\npurpose: K čemu je.\nuses: read-scanned-page, read-mixed-page\n---\n# Nadpis\n\nText.\n',
    )
    expect(skill).toMatchObject({
      key: 'zpracovani/pokus',
      group: 'zpracovani',
      kind: 'skill',
      title: 'Pokus',
      purpose: 'K čemu je.',
      uses: ['read-scanned-page', 'read-mixed-page'],
      content: '# Nadpis\n\nText.',
    })
  })

  it('refuses a place that does not exist', () => {
    expect(() => parseSkillFile('chat/pokus', '---\nuses: nikde\n---\nText.')).toThrow('nikde')
  })
})

describe('instructionsFor', () => {
  const skills = defaultSkills()

  it('puts the system prompt first, then the skills of the place, then the fixed lines', () => {
    const { text, skills: used } = instructionsFor(skills, 'read-scanned-page', ['Pevný řádek.'])
    expect(used.map((skill) => skill.key)).toEqual(['zpracovani/system', 'zpracovani/cteni-strany'])
    expect(text.indexOf('veřejný archiv')).toBeLessThan(text.indexOf('# Skill: Čtení strany'))
    expect(text.indexOf('# Skill: Čtení strany')).toBeLessThan(text.indexOf('Pevný řádek.'))
    // A skill of another place is not there.
    expect(text).not.toContain('Datum a rok dokumentu')
  })

  it('gives the decision model the skills without the system prompt', () => {
    expect(instructionsFor(skills, 'chat-rerank').skills.map((skill) => skill.key)).toEqual([
      'chat/hodnoceni-uryvku',
    ])
    const categorize = instructionsFor(skills, 'categorize')
    expect(categorize.skills.map((skill) => skill.key)).toEqual(['zpracovani/kategorie'])
    expect(categorize.text).not.toContain('veřejný archiv')
  })

  it('tells the description of a document two skills only: the name with the description, and the date', () => {
    const { skills: used } = instructionsFor(skills, 'describe-document')
    expect(used.map((skill) => skill.key)).toEqual([
      'zpracovani/system',
      'zpracovani/nazev-a-popis',
      'zpracovani/datum-dokumentu',
    ])
  })

  it('tells a skill the administrator added, and says which version', () => {
    const { text, skills: used } = instructionsFor(
      [
        ...skills,
        {
          key: 'vlastni/nazvy-zapisu',
          group: 'zpracovani',
          kind: 'skill',
          title: 'Názvy zápisů',
          purpose: '',
          uses: ['describe-document'],
          content: 'Název zápisu začíná slovem Zápis.',
          version: 3,
          builtIn: false,
        },
      ],
      'describe-document',
    )
    expect(text).toContain('# Skill: Názvy zápisů\n\nNázev zápisu začíná slovem Zápis.')
    expect(used).toContainEqual({ key: 'vlastni/nazvy-zapisu', version: 3 })
  })
})
