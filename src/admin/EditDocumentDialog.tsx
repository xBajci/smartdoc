import { useId, useState, type FormEvent } from 'react'
import { archive } from '~/archive/store'
import type { ArchiveDocument, Category } from '~/archive/types'
import { Dialog } from '~/components/Dialog'
import { cs, fill } from '~/copy/cs'

interface EditDocumentDialogProps {
  document: ArchiveDocument
  categories: readonly Category[]
  onClose: (saved: boolean) => void
}

export function EditDocumentDialog({
  document,
  categories,
  onClose,
}: Readonly<EditDocumentDialogProps>) {
  const [title, setTitle] = useState(document.title)
  const [categoryId, setCategoryId] = useState(document.categoryId)
  const [year, setYear] = useState(document.issuedYear === null ? '' : String(document.issuedYear))
  const [day, setDay] = useState(document.issuedOn ?? '')
  const [description, setDescription] = useState(document.customDescription)
  const [yearInvalid, setYearInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  /** `null` until the administrator opens the extracted text. */
  const [extracted, setExtracted] = useState<string | null>(null)
  const yearHintId = useId()
  const dayHintId = useId()
  const descriptionHintId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedYear = year.trim()
    if (trimmedYear !== '' && !/^\d{4}$/.test(trimmedYear)) {
      setYearInvalid(true)
      return
    }
    setSaving(true)
    archive
      .updateDocument(document.id, {
        title,
        categoryId,
        customDescription: description,
        issuedYear: trimmedYear === '' ? null : Number(trimmedYear),
        issuedOn: day === '' ? null : day,
      })
      .then(
        () => onClose(true),
        () => {
          setSaving(false)
          setFailed(true)
        },
      )
  }

  return (
    <Dialog title={cs.admin.editTitle} onClose={() => onClose(false)}>
      <form className="form" onSubmit={submit}>
        <p className="form__meta">
          {cs.admin.originalFilename}: {document.originalFilename}
        </p>
        <label className="field">
          <span>{cs.admin.fieldTitle}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="field">
          <span>{cs.admin.fieldCategory}</span>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--short">
          <span>{cs.admin.fieldYear}</span>
          <input
            inputMode="numeric"
            value={year}
            onChange={(event) => {
              setYear(event.target.value)
              setYearInvalid(false)
            }}
            aria-invalid={yearInvalid}
            aria-describedby={yearHintId}
          />
        </label>
        <p id={yearHintId} className={yearInvalid ? 'field-error' : 'field-hint'}>
          {yearInvalid
            ? cs.admin.yearInvalid
            : document.issuedYearSource === 'auto' && document.issuedYear !== null
              ? fill(cs.admin.fieldYearAuto, { year: document.issuedYear })
              : cs.admin.fieldYearHint}
        </p>
        <label className="field">
          <span>{cs.admin.fieldDate}</span>
          <input
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            aria-describedby={dayHintId}
          />
        </label>
        <p id={dayHintId} className="field-hint">
          {cs.admin.fieldDateHint}
        </p>
        <label className="field">
          <span>{cs.admin.fieldDescription}</span>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-describedby={descriptionHintId}
          />
        </label>
        <p id={descriptionHintId} className="field-hint">
          {cs.admin.fieldDescriptionHint}
        </p>
        {document.shortDescription === '' ? null : (
          <p className="form__meta">
            {cs.admin.shortDescriptionLabel}: {document.shortDescription}
          </p>
        )}
        <details
          onToggle={(event) => {
            if (!event.currentTarget.open || extracted !== null) return
            archive.extractedText(document.id).then(setExtracted, () => setExtracted(''))
          }}
        >
          <summary>{cs.admin.extractedTextLabel}</summary>
          <p className="extracted-text">
            {extracted === null
              ? cs.admin.extractedTextLoading
              : extracted === ''
                ? cs.admin.extractedTextEmpty
                : extracted}
          </p>
        </details>
        {failed ? (
          <p className="field-error" role="alert">
            {cs.admin.actionFailed}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => onClose(false)}>
            {cs.admin.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={saving}>
            {cs.admin.save}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
