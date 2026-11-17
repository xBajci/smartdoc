import { and, eq, max } from 'drizzle-orm'
import type { SkillInput, SkillsReport, SkillView } from '../archive/types'
import { getDatabase } from '../db/client'
import { customSkills, skillVersions } from '../db/schema'
import { defaultSkills, isSkillUse, SKILL_USES, SKILLS, type LoadedSkill } from './ai/skills'

/** The longest text of one skill. */
export const MAX_SKILL_CHARACTERS = 20_000
const MAX_TITLE_CHARACTERS = 120

/** The text of a stored wording; `null` for a row from before skills were Markdown. */
function contentOf(parts: Record<string, string>): string | null {
  return typeof parts.content === 'string' && parts.content.trim() !== '' ? parts.content : null
}

/**
 * Every skill with the text that is in use now: the starting skills, with the
 * text the administrator saved over them, and the skills the administrator
 * added. `includeDisabled` also gives the added skills that are switched off.
 */
export async function loadSkills(includeDisabled = false): Promise<LoadedSkill[]> {
  const database = getDatabase()
  const [active, custom] = await Promise.all([
    database.select().from(skillVersions).where(eq(skillVersions.status, 'active')),
    database.select().from(customSkills).orderBy(customSkills.createdAt),
  ])
  const texts = new Map<string, { content: string; version: number }>()
  for (const row of active) {
    const content = contentOf(row.parts)
    if (content !== null) texts.set(row.skillKey, { content, version: row.version ?? 0 })
  }

  const settings = new Map(custom.map((row) => [row.id, row]))
  const skills = defaultSkills().map((skill) => {
    // Places the administrator moved a starting skill to; a system prompt has none.
    const moved = skill.kind === 'skill' ? settings.get(skill.key)?.uses.filter(isSkillUse) : null
    return { ...skill, ...texts.get(skill.key), uses: moved ?? skill.uses }
  })
  for (const row of custom) {
    if (SKILLS.some((skill) => skill.key === row.id)) continue
    const text = texts.get(row.id)
    // A skill without a text, or one that is switched off, is told to no call.
    if (text === undefined || (!row.enabled && !includeDisabled)) continue
    skills.push({
      key: row.id,
      group: row.group,
      kind: 'skill',
      title: row.title,
      purpose: '',
      uses: row.uses.filter(isSkillUse),
      builtIn: false,
      ...text,
    })
  }
  return skills
}

/** Everything the administrator sees about skills: each with the text and the places in use. */
export async function skillsReport(): Promise<SkillsReport> {
  const [loaded, custom] = await Promise.all([
    loadSkills(true),
    getDatabase().select().from(customSkills),
  ])
  return {
    skills: loaded.map((skill): SkillView => ({
      ...skill,
      enabled: skill.builtIn || (custom.find((row) => row.id === skill.key)?.enabled ?? true),
      changed: skill.builtIn && (skill.version > 0 || custom.some((row) => row.id === skill.key)),
    })),
    uses: SKILL_USES.map((item) => ({ ...item })),
  }
}

type Writer = Pick<ReturnType<typeof getDatabase>, 'select' | 'update' | 'insert'>

/** Makes `content` the text of a skill that is in use; the text before it is kept as retired. */
async function activate(writer: Writer, skillKey: string, content: string, rationale: string) {
  const [last] = await writer
    .select({ version: max(skillVersions.version) })
    .from(skillVersions)
    .where(eq(skillVersions.skillKey, skillKey))
  const now = new Date()
  await writer
    .update(skillVersions)
    .set({ status: 'retired', decidedAt: now })
    .where(and(eq(skillVersions.skillKey, skillKey), eq(skillVersions.status, 'active')))
  await writer.insert(skillVersions).values({
    skillKey,
    version: (last?.version ?? 0) + 1,
    parts: { content },
    rationale,
    status: 'active',
    decidedAt: now,
  })
}

/** The text the administrator wrote for a skill. It is in use from the next call on. */
export async function saveSkill(skillKey: string, content: string): Promise<boolean> {
  const text = content.trim()
  if (text === '' || text.length > MAX_SKILL_CHARACTERS) return false
  const current = (await loadSkills(true)).find((skill) => skill.key === skillKey)
  if (current === undefined) return false
  if (current.content === text) return true
  await getDatabase().transaction((transaction) =>
    activate(transaction, skillKey, text, 'Upravil správce.'),
  )
  return true
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** What of a skill the administrator may set: a name and places of its own group. */
function checked(input: Pick<SkillInput, 'title' | 'group' | 'uses'>) {
  const title = input.title.trim().slice(0, MAX_TITLE_CHARACTERS)
  const uses = [...new Set(input.uses)].filter((use) =>
    SKILL_USES.some((item) => item.use === use && item.group === input.group),
  )
  return title === '' || uses.length === 0 ? null : { title, uses }
}

/** Adds a skill of the administrator's own. Returns its key, or `null` when the input is not complete. */
export async function createSkill(input: SkillInput): Promise<string | null> {
  const head = checked(input)
  const content = input.content.trim()
  if (head === null || content === '' || content.length > MAX_SKILL_CHARACTERS) return null
  const database = getDatabase()
  const taken = new Set(
    (await database.select({ id: customSkills.id }).from(customSkills)).map((row) => row.id),
  )
  const stem = `vlastni/${slugify(head.title) || 'skill'}`
  let id = stem
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${stem}-${suffix}`
  await database.transaction(async (transaction) => {
    await transaction.insert(customSkills).values({ id, group: input.group, ...head })
    await activate(transaction, id, content, 'Přidal správce.')
  })
  return id
}

/**
 * Moves a skill to other places. An added skill can also be renamed and
 * switched on and off; a starting skill keeps its name and is always on.
 */
export async function updateSkill(
  skillKey: string,
  changes: { title: string; uses: string[]; enabled: boolean },
): Promise<boolean> {
  const database = getDatabase()
  const starting = SKILLS.find((skill) => skill.key === skillKey)
  if (starting !== undefined) {
    if (starting.kind === 'system') return false
    const head = checked({ title: starting.title, group: starting.group, uses: changes.uses })
    if (head === null) return false
    await database
      .insert(customSkills)
      .values({ id: skillKey, group: starting.group, ...head })
      .onConflictDoUpdate({ target: customSkills.id, set: { uses: head.uses } })
    return true
  }
  const [row] = await database.select().from(customSkills).where(eq(customSkills.id, skillKey))
  if (row === undefined) return false
  const head = checked({ ...changes, group: row.group })
  if (head === null) return false
  await database
    .update(customSkills)
    .set({ ...head, enabled: changes.enabled })
    .where(eq(customSkills.id, skillKey))
  return true
}

/** Removes an added skill. Its texts stay as retired, so old records can still be read. */
export async function deleteSkill(skillKey: string) {
  if (SKILLS.some((skill) => skill.key === skillKey)) return
  await getDatabase().transaction(async (transaction) => {
    const removed = await transaction
      .delete(customSkills)
      .where(eq(customSkills.id, skillKey))
      .returning()
    if (removed.length === 0) return
    await transaction
      .update(skillVersions)
      .set({ status: 'retired', decidedAt: new Date() })
      .where(and(eq(skillVersions.skillKey, skillKey), eq(skillVersions.status, 'active')))
  })
}

/** Goes back to the starting text and the starting places from the code. Only a starting skill has them. */
export async function resetSkill(skillKey: string) {
  if (!SKILLS.some((skill) => skill.key === skillKey)) return
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(skillVersions)
      .set({ status: 'retired', decidedAt: new Date() })
      .where(and(eq(skillVersions.skillKey, skillKey), eq(skillVersions.status, 'active')))
    await transaction.delete(customSkills).where(eq(customSkills.id, skillKey))
  })
}
