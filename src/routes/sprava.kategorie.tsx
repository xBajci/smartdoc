import { createFileRoute } from '@tanstack/react-router'
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { CATEGORY_COLORS, startColor } from '~/archive/categories'
import { plural } from '~/archive/format'
import { archive, useArchive } from '~/archive/store'
import type { Category, CategoryInput } from '~/archive/types'
import { Dialog } from '~/components/Dialog'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'

export const Route = createFileRoute('/sprava/kategorie')({
  component: AdminCategories,
})

/** Where a dragged category would land: next to the category `id`, before it or after it. */
interface DropPlace {
  id: string
  after: boolean
}

function AdminCategories() {
  const { categories } = useArchive()
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Category | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropPlace, setDropPlace] = useState<DropPlace | null>(null)
  /** The order of the list from a move until the server has answered; `null` the rest of the time. */
  const [pending, setPending] = useState<string[] | null>(null)
  const list = useRef<HTMLUListElement>(null)
  /** The handle that keeps the keyboard focus after its row has moved. */
  const refocus = useRef<string | null>(null)

  // The first category is open when nothing was chosen yet, or the chosen one is gone.
  const chosen = categories.find((category) => category.id === chosenId) ?? categories[0]
  const fallback = categories.find((category) => category.isFallback)
  const movable = categories.filter((category) => !category.isFallback)
  const ordered =
    pending === null ? movable : pending.flatMap((id) => movable.find((it) => it.id === id) ?? [])
  const rows = fallback === undefined ? ordered : [...ordered, fallback]
  const orderKey = rows.map((row) => row.id).join()

  // A moved row is a new place in the page for the browser, and the focus would be lost there.
  useLayoutEffect(() => {
    const id = refocus.current
    if (id === null) return
    refocus.current = null
    list.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`)?.focus()
  }, [orderKey])

  /** Runs a change on the server; the archive reads the categories again by itself. */
  async function change(work: () => Promise<string>) {
    setBusy(true)
    setMessage(null)
    try {
      setMessage(await work())
    } catch {
      setMessage(cs.admin.actionFailed)
    } finally {
      setBusy(false)
    }
  }

  /** Saves the new order. The list shows it at once, and the server's answer confirms it. */
  function reorder(ids: string[], movedId: string) {
    const moved = categories.find((category) => category.id === movedId)
    setPending(ids)
    setMessage(null)
    archive
      .reorderCategories(ids)
      .then(
        () =>
          setMessage(
            fill(cs.categories.moved, {
              name: moved?.name ?? '',
              position: ids.indexOf(movedId) + 1,
              total: ids.length,
            }),
          ),
        () => setMessage(cs.admin.actionFailed),
      )
      .finally(() => setPending(null))
  }

  function startDrag(event: DragEvent<HTMLElement>, id: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    // The whole row follows the pointer, not only the small handle.
    const row = event.currentTarget.closest('li')
    if (row !== null) event.dataTransfer.setDragImage(row, 24, row.offsetHeight / 2)
    setDragging(id)
  }

  function endDrag() {
    setDragging(null)
    setDropPlace(null)
  }

  function dragOver(event: DragEvent<HTMLLIElement>, category: Category) {
    if (dragging === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (category.id === dragging) {
      setDropPlace(null)
    } else if (category.isFallback) {
      // The fallback category stays last: dropping on it means "after the last other one".
      const last = ordered.at(-1)
      setDropPlace(last === undefined ? null : { id: last.id, after: true })
    } else {
      const box = event.currentTarget.getBoundingClientRect()
      setDropPlace({ id: category.id, after: event.clientY > box.top + box.height / 2 })
    }
  }

  function drop(event: DragEvent<HTMLLIElement>) {
    event.preventDefault()
    const place = dropPlace
    const movedId = dragging
    endDrag()
    if (movedId === null || place === null) return
    const ids = ordered.map((category) => category.id).filter((id) => id !== movedId)
    ids.splice(ids.indexOf(place.id) + (place.after ? 1 : 0), 0, movedId)
    if (ids.join() !== ordered.map((category) => category.id).join()) reorder(ids, movedId)
  }

  /** The arrow keys on a handle move its row by one place; there is no button for it. */
  function moveByKey(event: KeyboardEvent<HTMLElement>, id: string) {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (step === 0) return
    event.preventDefault()
    const ids = ordered.map((category) => category.id)
    const from = ids.indexOf(id)
    const to = from + step
    if (to < 0 || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    refocus.current = id
    reorder(ids, id)
  }

  return (
    <section className="admin-section skills-page" aria-labelledby="admin-categories-title">
      <div className="admin-section__head">
        <div>
          <h1 id="admin-categories-title">{cs.admin.navCategories}</h1>
          <p className="field-hint">{cs.categories.subtitle}</p>
        </div>
        <button
          type="button"
          className="button button--primary"
          onClick={() => setAdding(true)}
          disabled={busy}
        >
          <Icon name="plus" />
          {cs.categories.add}
        </button>
      </div>
      <p className="flash" role="status">
        {message}
      </p>

      <div className="skills-layout">
        <nav className="skills-nav" aria-label={cs.categories.listLabel}>
          <section className="skills-nav__group" aria-label={cs.categories.listTitle}>
            <h2>{cs.categories.listTitle}</h2>
            <p className="field-hint">
              {plural(categories.length, 'kategorie', 'kategorie', 'kategorií')}
              {' · '}
              {cs.categories.reorderHint}
            </p>
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- clears the drop mark; the keyboard has the arrow keys on the handle */}
            <ul
              ref={list}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropPlace(null)
                }
              }}
            >
              {rows.map((category) => {
                const classes = ['category-nav__row']
                if (dragging === category.id) classes.push('category-nav__row--dragging')
                if (dropPlace?.id === category.id) {
                  classes.push(
                    dropPlace.after ? 'category-nav__row--after' : 'category-nav__row--before',
                  )
                }
                return (
                  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keyboard moves a row with the arrow keys on its handle
                  <li
                    key={category.id}
                    className={classes.join(' ')}
                    onDragOver={(event) => dragOver(event, category)}
                    onDrop={drop}
                  >
                    {category.isFallback ? null : (
                      // The fallback category stays last, so it has nothing to drag.
                      <span
                        role="button"
                        tabIndex={0}
                        draggable
                        className="category-nav__grip"
                        data-grip={category.id}
                        aria-label={`${cs.categories.reorder}: ${category.name}`}
                        title={cs.categories.reorderHint}
                        onDragStart={(event) => startDrag(event, category.id)}
                        onDragEnd={endDrag}
                        onKeyDown={(event) => moveByKey(event, category.id)}
                      >
                        <Icon name="grip" size={16} />
                      </span>
                    )}
                    <button
                      type="button"
                      className="skills-nav__item"
                      aria-current={category.id === chosen?.id}
                      onClick={() => setChosenId(category.id)}
                    >
                      <i
                        className="category-nav__tab"
                        style={{ background: category.color }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{category.name}</strong>
                        {category.description === '' ? null : <small>{category.description}</small>}
                      </span>
                      <small className="category-nav__count">
                        <span aria-hidden="true">{category.documentCount}</span>
                        <span className="visually-hidden">
                          {plural(category.documentCount, 'dokument', 'dokumenty', 'dokumentů')}
                        </span>
                      </small>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        </nav>

        {chosen === undefined ? null : (
          <CategoryEditor
            // A stored change gives the editor the new values to start from.
            key={`${chosen.id}:${chosen.name}:${chosen.description}:${chosen.color}`}
            category={chosen}
            busy={busy}
            onSave={(input) =>
              void change(async () => {
                await archive.updateCategory(chosen.id, input)
                return fill(cs.categories.savedMessage, { name: input.name })
              })
            }
            onRemove={setRemoving}
          />
        )}
      </div>

      {adding ? (
        <NewCategoryDialog
          color={startColor(movable.length)}
          onClose={() => setAdding(false)}
          onCreate={async (input) => {
            let created = false
            await change(async () => {
              const id = await archive.addCategory(input)
              created = true
              // The new category is the one that is open.
              setChosenId(id)
              return fill(cs.categories.createdMessage, { name: input.name })
            })
            return created
          }}
        />
      ) : null}

      {removing === null ? null : (
        <Dialog title={cs.categories.removeTitle} onClose={() => setRemoving(null)}>
          <p>
            {fill(cs.categories.removeText, {
              name: removing.name,
              count: removing.documentCount,
              fallback: fallback?.name ?? '',
            })}
          </p>
          <div className="dialog__actions">
            <button type="button" className="button" onClick={() => setRemoving(null)}>
              {cs.admin.cancel}
            </button>
            <button
              type="button"
              className="button button--danger-solid"
              onClick={() => {
                const { id, name } = removing
                setRemoving(null)
                setChosenId(null)
                void change(async () => {
                  await archive.removeCategory(id)
                  return fill(cs.categories.removedMessage, { name })
                })
              }}
            >
              {cs.categories.removeConfirm}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

/** Name, description and colour, the same fields for a new category and for a change. */
function CategoryFields({
  value,
  onChange,
}: Readonly<{ value: CategoryInput; onChange: (changes: Partial<CategoryInput>) => void }>) {
  // The editor and the dialog can be open together, so their fields need ids of their own.
  const id = useId()
  return (
    <>
      <div className="skill-editor__part">
        <label className="skill-editor__label" htmlFor={`${id}-name`}>
          {cs.categories.nameField}
        </label>
        <input
          id={`${id}-name`}
          className="category-editor__name"
          value={value.name}
          maxLength={100}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <div className="skill-editor__part">
        <label className="skill-editor__label" htmlFor={`${id}-description`}>
          {cs.categories.descriptionField}
        </label>
        <textarea
          id={`${id}-description`}
          rows={5}
          maxLength={1000}
          value={value.description}
          placeholder={cs.categories.descriptionPlaceholder}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>
      <fieldset className="skill-editor__part category-colors">
        <legend>{cs.categories.colorField}</legend>
        <div className="category-colors__row">
          {CATEGORY_COLORS.map((color) => (
            <label
              key={color}
              className="category-swatch"
              style={{ '--swatch': color } as CSSProperties}
            >
              <input
                type="radio"
                name={`${id}-color`}
                className="visually-hidden"
                checked={value.color === color}
                onChange={() => onChange({ color })}
              />
              <span className="visually-hidden">{cs.categories.colors[color]}</span>
              <Icon name="check" size={18} />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}

interface CategoryEditorProps {
  category: Category
  busy: boolean
  onSave: (input: CategoryInput) => void
  onRemove: (category: Category) => void
}

/** The right side of the page: everything about one category, edited in place and saved with one button. */
function CategoryEditor({ category, busy, onSave, onRemove }: Readonly<CategoryEditorProps>) {
  const original = {
    name: category.name,
    description: category.description,
    color: category.color,
  }
  const [draft, setDraft] = useState<CategoryInput>(original)
  const changed =
    draft.name !== original.name ||
    draft.description !== original.description ||
    draft.color !== original.color
  const complete = draft.name.trim() !== ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (changed && complete) {
      onSave({
        name: draft.name.trim(),
        description: draft.description.trim(),
        color: draft.color,
      })
    }
  }

  return (
    <form className="skill-editor" aria-label={cs.categories.panelLabel} onSubmit={submit}>
      <div className="skill-editor__head">
        <div>
          <h2>{category.name}</h2>
          <p className="field-hint">
            {plural(category.documentCount, 'dokument', 'dokumenty', 'dokumentů')}
            {category.isFallback ? ` · ${cs.categories.fallbackNote}` : ''}
          </p>
        </div>
        <div className="skill-editor__state">
          {category.isFallback ? null : (
            <button
              type="button"
              className="icon-button icon-button--danger"
              onClick={() => onRemove(category)}
              disabled={busy}
              aria-label={`${cs.categories.remove}: ${category.name}`}
              data-tip={cs.categories.remove}
            >
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      </div>

      <CategoryFields value={draft} onChange={(changes) => setDraft({ ...draft, ...changes })} />

      <div className="skill-editor__foot">
        <span role="status">{changed ? cs.categories.unsaved : ''}</span>
        <button
          type="button"
          className="button"
          onClick={() => setDraft(original)}
          disabled={busy || !changed}
        >
          {cs.categories.cancel}
        </button>
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || !changed || !complete}
        >
          {cs.categories.save}
        </button>
      </div>
    </form>
  )
}

interface NewCategoryDialogProps {
  /** The colour the dialog starts with. */
  color: string
  onClose: () => void
  /** Returns whether the category was added. */
  onCreate: (input: CategoryInput) => Promise<boolean>
}

function NewCategoryDialog({ color, onClose, onCreate }: Readonly<NewCategoryDialogProps>) {
  const [draft, setDraft] = useState<CategoryInput>({ name: '', description: '', color })
  const [saving, setSaving] = useState(false)
  const complete = draft.name.trim() !== ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!complete) return
    setSaving(true)
    void onCreate({
      name: draft.name.trim(),
      description: draft.description.trim(),
      color: draft.color,
    }).then((created) => {
      if (created) onClose()
      else setSaving(false)
    })
  }

  return (
    <Dialog title={cs.categories.newTitle} onClose={onClose}>
      <form className="form category-new" onSubmit={submit}>
        <CategoryFields value={draft} onChange={(changes) => setDraft({ ...draft, ...changes })} />
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            {cs.categories.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={!complete || saving}>
            <Icon name="plus" />
            {cs.categories.create}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
