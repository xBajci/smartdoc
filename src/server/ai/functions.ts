import { createServerFn } from '@tanstack/react-start'
import type { SkillInput, SkillsReport, UsageReport } from '~/ai/types'
import { text, texts } from '../input'
import { adminOrNull, forAdmin } from '../session'
import {
  createSkill,
  deleteSkill,
  MAX_SKILL_CHARACTERS,
  resetSkill,
  saveSkill,
  skillsReport,
  updateSkill,
} from '../skills-service'
import { usageReport } from '../usage-service'

/** What the browser calls on the server for the skills and the costs of the models. */

/** What the calls to models have cost. `null` for a visitor, so the page can show the sign-in form instead. */
export const getUsageFn = createServerFn({ method: 'GET' }).handler(
  adminOrNull((): Promise<UsageReport> => usageReport()),
)

export const getSkillsFn = createServerFn({ method: 'GET' }).handler(
  adminOrNull((): Promise<SkillsReport> => skillsReport()),
)

function skillGroup(value: unknown): 'zpracovani' | 'chat' {
  if (value !== 'zpracovani' && value !== 'chat') throw new Error('Invalid input.')
  return value
}

/** The text the administrator wrote for a skill; it is in use from the next call on. */
export const saveSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string; content: string }) => ({
    key: text(data.key, 200),
    content: text(data.content, MAX_SKILL_CHARACTERS),
  }))
  .handler(forAdmin(({ data }) => saveSkill(data.key, data.content)))

/** A skill of the administrator's own. Returns its key, or `null` when the input is not complete. */
export const createSkillFn = createServerFn({ method: 'POST' })
  .validator((data: SkillInput) => ({
    title: text(data.title, 200),
    group: skillGroup(data.group),
    uses: texts(data.uses, 20),
    content: text(data.content, MAX_SKILL_CHARACTERS),
  }))
  .handler(forAdmin(({ data }) => createSkill(data)))

export const updateSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string; title: string; uses: string[]; enabled: boolean }) => ({
    key: text(data.key, 200),
    title: text(data.title, 200),
    uses: texts(data.uses, 20),
    enabled: data.enabled === true,
  }))
  .handler(forAdmin(({ data }) => updateSkill(data.key, data)))

export const deleteSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string }) => ({ key: text(data.key, 200) }))
  .handler(
    forAdmin(async ({ data }) => {
      await deleteSkill(data.key)
    }),
  )

export const resetSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string }) => ({ key: text(data.key, 200) }))
  .handler(
    forAdmin(async ({ data }) => {
      await resetSkill(data.key)
    }),
  )
