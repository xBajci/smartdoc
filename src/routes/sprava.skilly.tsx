import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import type { SkillsReport, SkillView } from '~/archive/types'
import { Dialog } from '~/components/Dialog'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'
import {
  createSkillFn,
  deleteSkillFn,
  getSkillsFn,
  resetSkillFn,
  saveSkillFn,
  updateSkillFn,
} from '~/server/archive'

export const Route = createFileRoute('/sprava/skilly')({
  loader: () => getSkillsFn(),
  component: AdminSkills,
})

type Group = SkillView['group']
type Uses = SkillsReport['uses']

const GROUPS: readonly { group: Group; title: string }[] = [
  { group: 'zpracovani', title: cs.skills.groupProcessing },
  { group: 'chat', title: cs.skills.groupChat },
]

function sameSet(first: readonly string[], second: readonly string[]) {
  return first.length === second.length && first.every((item) => second.includes(item))
}

interface SkillEditorProps {
  skill: SkillView
  uses: Uses
  busy: boolean
  /** Stores the text, the places and the name together. */
  onSave: (skill: SkillView, draft: { title: string; uses: string[]; content: string }) => void
  onReset: (skill: SkillView) => void
  onEnable: (skill: SkillView, enabled: boolean) => void
  onRemove: (skill: SkillView) => void
}

/** The right side of the page: everything about one skill, edited in place and saved with one button. */
function SkillEditor({ skill, uses, busy, ...actions }: Readonly<SkillEditorProps>) {
  const [title, setTitle] = useState(skill.title)
  const [content, setContent] = useState(skill.content)
  const [chosen, setChosen] = useState<string[]>(skill.uses)
  const places = uses.filter((item) => item.group === skill.group)
  const isSystem = skill.kind === 'system'
  const changed = content !== skill.content || title !== skill.title || !sameSet(chosen, skill.uses)
  // A skill with no place would be told to no call.
  const complete = content.trim() !== '' && title.trim() !== '' && (isSystem || chosen.length > 0)

  function cancel() {
    setTitle(skill.title)
    setContent(skill.content)
    setChosen(skill.uses)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (changed && complete) actions.onSave(skill, { title, uses: chosen, content })
  }

  return (
    <form className="skill-editor" aria-label={skill.title} onSubmit={submit}>
      <div className="skill-editor__head">
        <div>
          {skill.builtIn ? (
            <h2>{skill.title}</h2>
          ) : (
            // Only a skill the administrator added can be renamed.
            <input
              className="skill-editor__title"
              value={title}
              aria-label={cs.skills.titleLabel}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
          <p className="field-hint">
            {isSystem ? cs.skills.systemNote : skill.builtIn ? skill.purpose : cs.skills.own}
          </p>
          <code className="skill-editor__key">{skill.key}</code>
        </div>
        <div className="skill-editor__state">
          {skill.enabled ? null : (
            <span className="skill__tag skill__tag--off">{cs.skills.disabled}</span>
          )}
          <span className="skill__version">
            {skill.version === 0
              ? cs.skills.versionDefault
              : fill(cs.skills.version, { version: skill.version })}
          </span>
          {skill.builtIn ? null : (
            <>
              <button
                type="button"
                className="link-button"
                onClick={() => actions.onEnable(skill, !skill.enabled)}
                disabled={busy}
              >
                {skill.enabled ? cs.skills.disable : cs.skills.enable}
              </button>
              <button
                type="button"
                className="icon-button icon-button--danger"
                onClick={() => actions.onRemove(skill)}
                disabled={busy}
                aria-label={`${cs.skills.remove}: ${skill.title}`}
                data-tip={cs.skills.remove}
              >
                <Icon name="trash" size={18} />
              </button>
            </>
          )}
        </div>
      </div>

      {isSystem ? null : (
        // Where the skill is attached; the system puts it there by itself.
        <fieldset className="skill-editor__part skill__places" disabled={busy}>
          <legend>{cs.skills.usesLabel}</legend>
          <div className="skill__checks">
            {places.map((item) => (
              <label key={item.use} className="check">
                <input
                  type="checkbox"
                  checked={chosen.includes(item.use)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, item.use]
                        : current.filter((use) => use !== item.use),
                    )
                  }
                />
                {item.label}
              </label>
            ))}
          </div>
          {chosen.length === 0 ? <p className="field-error">{cs.skills.lastPlace}</p> : null}
        </fieldset>
      )}

      <div className="skill-editor__part">
        <label className="skill-editor__label" htmlFor={`skill-text-${skill.key}`}>
          {cs.skills.contentTitle} <span>{cs.skills.contentFormat}</span>
        </label>
        <textarea
          id={`skill-text-${skill.key}`}
          className="skill__editor"
          value={content}
          rows={Math.min(28, Math.max(10, content.split('\n').length + 2))}
          onChange={(event) => setContent(event.target.value)}
        />
        {skill.changed ? (
          <button
            type="button"
            className="link-button"
            onClick={() => actions.onReset(skill)}
            disabled={busy}
          >
            {cs.skills.reset}
          </button>
        ) : null}
      </div>

      <div className="skill-editor__foot">
        <span role="status">{changed ? cs.skills.unsaved : ''}</span>
        <button type="button" className="button" onClick={cancel} disabled={busy || !changed}>
          {cs.skills.cancel}
        </button>
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || !changed || !complete}
        >
          {cs.skills.saveChanges}
        </button>
      </div>
    </form>
  )
}

interface NewSkillDialogProps {
  /** The group the dialog starts with. */
  group: Group
  uses: Uses
  onClose: () => void
  /** Returns whether the skill was added. */
  onCreate: (input: {
    title: string
    group: Group
    uses: string[]
    content: string
  }) => Promise<boolean>
}

function NewSkillDialog(props: Readonly<NewSkillDialogProps>) {
  const [group, setGroup] = useState(props.group)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const places = props.uses.filter((item) => item.group === group)
  const complete = title.trim() !== '' && content.trim() !== '' && chosen.length > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!complete) return
    setSaving(true)
    void props.onCreate({ title, group, uses: chosen, content }).then((created) => {
      if (created) props.onClose()
      else setSaving(false)
    })
  }

  return (
    <Dialog title={cs.skills.addTitle} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <p className="field-hint">{cs.skills.addHint}</p>
        <label className="field">
          <span>{cs.skills.titleLabel}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <fieldset className="skill__places">
          <legend>{cs.skills.groupLegend}</legend>
          <div className="skill__checks">
            {GROUPS.map((item) => (
              <label key={item.group} className="check">
                <input
                  type="radio"
                  name="skill-group"
                  checked={group === item.group}
                  onChange={() => {
                    setGroup(item.group)
                    // A place belongs to one group only.
                    setChosen([])
                  }}
                />
                {item.title}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="skill__places">
          <legend>{cs.skills.usesLegend}</legend>
          <div className="skill__checks">
            {places.map((item) => (
              <label key={item.use} className="check">
                <input
                  type="checkbox"
                  checked={chosen.includes(item.use)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, item.use]
                        : current.filter((use) => use !== item.use),
                    )
                  }
                />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>{cs.skills.contentLabel}</span>
          <textarea
            className="skill__editor"
            rows={10}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
          />
        </label>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={props.onClose} disabled={saving}>
            {cs.skills.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={!complete || saving}>
            <Icon name="plus" />
            {cs.skills.create}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function AdminSkills() {
  const report = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<SkillView | null>(null)
  // A visitor gets no report; the layout above already shows the sign-in form.
  if (report === null) return null

  // The first skill that is not a system prompt is open when nothing was chosen yet.
  const chosen =
    report.skills.find((skill) => skill.key === chosenKey) ??
    report.skills.find((skill) => skill.kind === 'skill') ??
    report.skills[0]

  /** Runs a change on the server, then reads the skills again. */
  async function change(work: () => Promise<string>) {
    setBusy(true)
    setMessage(null)
    try {
      const done = await work()
      await router.invalidate()
      setMessage(done)
    } catch {
      setMessage(cs.admin.actionFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-section skills-page" aria-labelledby="admin-skills-title">
      <div className="admin-section__head">
        <div>
          <h1 id="admin-skills-title">{cs.admin.navSkills}</h1>
          <p className="field-hint">{cs.skills.subtitle}</p>
        </div>
        <button
          type="button"
          className="button button--primary"
          onClick={() => setAdding(true)}
          disabled={busy}
        >
          <Icon name="plus" />
          {cs.skills.add}
        </button>
      </div>
      <p className="flash" role="status">
        {message}
      </p>

      <div className="skills-layout">
        <nav className="skills-nav" aria-label={cs.skills.listLabel}>
          {GROUPS.map(({ group, title }) => {
            const skills = report.skills.filter((skill) => skill.group === group)
            return (
              <section key={group} className="skills-nav__group" aria-label={title}>
                <h2>{title}</h2>
                <p className="field-hint">{cs.skills.groupNote}</p>
                <ul>
                  {/* The system prompt first: every call of the group starts with it. */}
                  {[
                    ...skills.filter((skill) => skill.kind === 'system'),
                    ...skills.filter((skill) => skill.kind !== 'system'),
                  ].map((skill) => (
                    <li
                      key={skill.key}
                      className={skill.kind === 'system' ? 'skills-nav__system' : undefined}
                    >
                      <button
                        type="button"
                        className="skills-nav__item"
                        aria-current={skill.key === chosen?.key}
                        onClick={() => setChosenKey(skill.key)}
                      >
                        <Icon name={skill.kind === 'system' ? 'settings' : 'pdf'} size={20} />
                        <span>
                          <strong>{skill.title}</strong>
                          <small>
                            {skill.kind === 'system'
                              ? cs.skills.systemShort
                              : skill.builtIn
                                ? skill.purpose
                                : cs.skills.own}
                          </small>
                        </span>
                        {skill.enabled ? null : (
                          <span className="skill__tag skill__tag--off">{cs.skills.disabled}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </nav>

        {chosen === undefined ? null : (
          <SkillEditor
            // A stored change gives the editor the new text to start from.
            key={`${chosen.key}:${chosen.version}:${chosen.uses.join()}:${chosen.title}`}
            skill={chosen}
            uses={report.uses}
            busy={busy}
            onSave={(skill, draft) =>
              void change(async () => {
                const content =
                  draft.content === skill.content ||
                  (await saveSkillFn({ data: { key: skill.key, content: draft.content } }))
                const head =
                  skill.kind === 'system' ||
                  (sameSet(draft.uses, skill.uses) && draft.title === skill.title) ||
                  (await updateSkillFn({
                    data: {
                      key: skill.key,
                      title: draft.title,
                      uses: draft.uses,
                      enabled: skill.enabled,
                    },
                  }))
                return content && head
                  ? fill(cs.skills.saved, { title: draft.title.trim() })
                  : cs.skills.saveFailed
              })
            }
            onReset={(skill) =>
              void change(async () => {
                await resetSkillFn({ data: { key: skill.key } })
                return fill(cs.skills.resetDone, { title: skill.title })
              })
            }
            onEnable={(skill, enabled) =>
              void change(async () => {
                await updateSkillFn({
                  data: { key: skill.key, title: skill.title, uses: skill.uses, enabled },
                })
                return fill(enabled ? cs.skills.enabledDone : cs.skills.disabledDone, {
                  title: skill.title,
                })
              })
            }
            onRemove={setRemoving}
          />
        )}
      </div>

      {adding ? (
        <NewSkillDialog
          group={chosen?.group ?? 'zpracovani'}
          uses={report.uses}
          onClose={() => setAdding(false)}
          onCreate={async (input) => {
            let created: string | null = null
            await change(async () => {
              created = await createSkillFn({ data: input })
              return created === null
                ? cs.skills.createFailed
                : fill(cs.skills.created, { title: input.title.trim() })
            })
            // The new skill is the one that is open.
            if (created !== null) setChosenKey(created)
            return created !== null
          }}
        />
      ) : null}

      {removing === null ? null : (
        <Dialog title={cs.skills.removeTitle} onClose={() => setRemoving(null)}>
          <p>{fill(cs.skills.removeText, { title: removing.title })}</p>
          <div className="dialog__actions">
            <button type="button" className="button" onClick={() => setRemoving(null)}>
              {cs.skills.cancel}
            </button>
            <button
              type="button"
              className="button button--danger-solid"
              onClick={() => {
                const { key, title } = removing
                setRemoving(null)
                void change(async () => {
                  await deleteSkillFn({ data: { key } })
                  return fill(cs.skills.removed, { title })
                })
              }}
            >
              {cs.skills.removeConfirm}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
