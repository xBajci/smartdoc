import { Link } from '@tanstack/react-router'
import { useRef, useState, type DragEvent } from 'react'
import { formatSize, plural } from '~/archive/format'
import { archive, useArchive } from '~/archive/store'
import type { ArchiveDocument } from '~/archive/types'
import {
  ACCEPTED_EXTENSIONS,
  inspectFile,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  type InspectedFile,
  type UploadProblem,
} from '~/archive/upload'
import { Dialog } from '~/components/Dialog'
import { FileBadge } from '~/components/FileBadge'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'

interface BatchItem {
  key: string
  file: File
  categoryId: string
  description: string
  descriptionOpen: boolean
  /** `null` while the file is being read. */
  inspection: InspectedFile | null
  /** The archive document with the same content, if there is one. */
  duplicate: ArchiveDocument | null
  state: 'waiting' | 'uploading' | 'uploaded'
  /** How much of the file has been sent, from 0 to 1. */
  progress: number
  /** What the server said when it refused this file. */
  failure: UploadProblem | 'failed' | null
}

let nextKey = 0

/** Decides, against the whole batch, what stops each item from being uploaded. */
function assessBatch(items: readonly BatchItem[]) {
  const seen = new Set<string>()
  let accepted = 0
  const rows: {
    item: BatchItem
    problem: string | null
    ready: boolean
    duplicate: ArchiveDocument | null
  }[] = []
  for (const item of items) {
    const duplicate = item.duplicate
    let problem: string | null = null
    const sha = item.inspection?.sha256
    const refused = item.failure ?? item.inspection?.problem ?? null
    if (item.state !== 'waiting' || item.inspection === null) {
      problem = null
    } else if (refused === 'unsupported') {
      problem = cs.upload.problemUnsupported
    } else if (refused === 'empty') {
      problem = cs.upload.problemEmpty
    } else if (refused === 'too-large') {
      problem = fill(cs.upload.problemTooLarge, { size: formatSize(MAX_FILE_BYTES) })
    } else if (refused === 'failed') {
      problem = cs.upload.problemFailed
    } else if (duplicate !== null) {
      problem = fill(cs.upload.duplicate, { title: duplicate.title })
    } else if (sha !== undefined && seen.has(sha)) {
      problem = cs.upload.duplicateInBatch
    } else if (accepted >= MAX_BATCH_FILES) {
      problem = fill(cs.upload.problemBatch, { count: MAX_BATCH_FILES })
    }
    const ready = item.state === 'waiting' && item.inspection !== null && problem === null
    if (ready) {
      accepted += 1
      if (sha !== undefined) seen.add(sha)
    }
    rows.push({ item, problem, ready, duplicate })
  }
  return rows
}

interface UploadDialogProps {
  /**
   * Called when the window closes, with the ids of the documents that were
   * stored. Reading their content starts only then, in the list of documents.
   */
  onClose: (storedIds: string[]) => void
}

/**
 * Choosing files and sending them to storage. The window closes by itself
 * when every chosen file is stored; it stays open only to show what was refused.
 */
export function UploadDialog({ onClose }: Readonly<UploadDialogProps>) {
  const { categories } = useArchive()
  const [items, setItems] = useState<BatchItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)
  const stored = useRef<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  function patchItem(key: string, patch: Partial<BatchItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  function addFiles(files: FileList | null) {
    if (files === null || files.length === 0) return
    const added = Array.from(files, (file): BatchItem => {
      nextKey += 1
      return {
        key: `file-${nextKey}`,
        file,
        // Empty: the category is left to processing.
        categoryId: '',
        description: '',
        descriptionOpen: false,
        inspection: null,
        duplicate: null,
        state: 'waiting',
        progress: 0,
        failure: null,
      }
    })
    setItems((current) => [...current, ...added])
    for (const item of added) {
      void inspectFile(item.file).then(async (inspection) => {
        // A failed look-up is not a reason to refuse the file: the server checks again on upload.
        const duplicate = await archive.duplicateOf(inspection.sha256).catch(() => null)
        patchItem(item.key, { inspection, duplicate })
      })
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    if (!running) addFiles(event.dataTransfer.files)
  }

  const rows = assessBatch(items)
  const readyRows = rows.filter((row) => row.ready)
  const checking = items.some((item) => item.inspection === null)

  async function save() {
    setRunning(true)
    let refused = rows.length - readyRows.length
    // Files go one after another and independently: a failure of one would not stop the rest.
    for (const { item } of readyRows) {
      if (item.inspection === null) continue
      patchItem(item.key, { state: 'uploading', progress: 0 })
      const result = await archive.uploadDocument(
        {
          file: item.file,
          sha256: item.inspection.sha256,
          categoryId: item.categoryId,
          customDescription: item.description,
        },
        (progress) => patchItem(item.key, { progress }),
      )
      if (result.ok) {
        stored.current.push(result.id)
        patchItem(item.key, { state: 'uploaded', progress: 1 })
        continue
      }
      refused += 1
      if (result.problem === 'duplicate') {
        const [duplicate] = await archive
          .documentsById(result.duplicateId === undefined ? [] : [result.duplicateId])
          .catch(() => [])
        patchItem(item.key, {
          state: 'waiting',
          duplicate: duplicate ?? null,
          failure: duplicate === undefined ? 'failed' : null,
        })
      } else patchItem(item.key, { state: 'waiting', failure: result.problem })
    }
    setRunning(false)
    // Something was refused: the window stays, so the reason can be read.
    if (refused === 0) onClose(stored.current)
  }

  return (
    <Dialog
      title={cs.upload.title}
      wide
      onClose={() => {
        if (!running) onClose(stored.current)
      }}
    >
      {/* A click anywhere in the area opens the file window; the link inside does the same for the keyboard. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={dragging ? 'dropzone dropzone--over' : 'dropzone'}
        onClick={(event) => {
          if (!running && !(event.target instanceof HTMLButtonElement)) fileInput.current?.click()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Icon name="cloud" size={34} />
        <p className="dropzone__title">
          {cs.upload.dropTitle}{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => fileInput.current?.click()}
            disabled={running}
          >
            {cs.upload.dropAction}
          </button>
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="visually-hidden"
          tabIndex={-1}
          aria-label={cs.upload.dropAction}
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <p>{cs.upload.formats}</p>
        <p className="field-hint">
          {fill(cs.upload.limits, { size: formatSize(MAX_FILE_BYTES), count: MAX_BATCH_FILES })}
        </p>
      </div>

      {items.length === 0 ? null : (
        <table className="document-table admin-table batch">
          <thead>
            <tr>
              <th scope="col">{cs.upload.columnFile}</th>
              <th scope="col">{cs.upload.columnCategory}</th>
              <th scope="col">{cs.upload.columnDescription}</th>
              <th scope="col">
                <span className="visually-hidden">{cs.admin.columnActions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, problem, duplicate }) => {
              const open = item.descriptionOpen || item.description.trim() !== ''
              const percent = Math.round(item.progress * 100)
              return (
                <tr
                  key={item.key}
                  className={[
                    'batch-item',
                    problem === null ? '' : 'batch-item--problem',
                    open && item.state === 'waiting' ? 'batch-item--open' : '',
                  ].join(' ')}
                >
                  <td>
                    <div className="document-row">
                      <FileBadge mimeType={item.inspection?.detected?.mimeType ?? null} />
                      <div className="batch-item__file">
                        <strong>{item.file.name}</strong>
                        <span>{formatSize(item.file.size)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={cs.upload.categoryLabel}
                      value={item.categoryId}
                      onChange={(event) => patchItem(item.key, { categoryId: event.target.value })}
                      disabled={running || item.state !== 'waiting'}
                    >
                      <option value="">{cs.upload.categoryAuto}</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="batch-item__description">
                    {item.state === 'uploading' ? (
                      <label className="upload-progress">
                        <span>
                          {cs.status.uploading} {percent} %
                        </span>
                        <progress max={100} value={percent} />
                      </label>
                    ) : item.state === 'uploaded' ? (
                      <span className="status status--ready">
                        <Icon name="check" size={15} />
                        {cs.upload.uploaded}
                      </span>
                    ) : item.inspection === null ? (
                      <p className="field-hint" role="status">
                        {cs.upload.checking}
                      </p>
                    ) : problem !== null ? (
                      <p className="field-error" role="alert">
                        <Icon name="alert" size={15} />
                        {problem}{' '}
                        {duplicate?.status === 'ready' ? (
                          <Link to="/" search={{ doc: duplicate.id }}>
                            {cs.upload.openExisting}
                          </Link>
                        ) : null}
                      </p>
                    ) : open ? (
                      <label className="batch-item__custom">
                        <span>{cs.upload.descriptionCaption}</span>
                        <textarea
                          rows={2}
                          value={item.description}
                          aria-label={fill(cs.upload.descriptionLabel, { name: item.file.name })}
                          onChange={(event) =>
                            patchItem(item.key, { description: event.target.value })
                          }
                          disabled={running}
                        />
                      </label>
                    ) : (
                      <div className="batch-item__auto">
                        <span>{cs.upload.descriptionAuto}</span>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => patchItem(item.key, { descriptionOpen: true })}
                          disabled={running}
                        >
                          {cs.upload.descriptionToggle}
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    {item.state === 'waiting' ? (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() =>
                          setItems((current) => current.filter((other) => other.key !== item.key))
                        }
                        disabled={running}
                        aria-label={fill(cs.upload.removeNamed, { name: item.file.name })}
                      >
                        <Icon name="close" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="batch-start">
        <p className="batch-start__note">
          <Icon name="info" />
          {cs.upload.publishNote}
        </p>
        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => onClose(stored.current)}
            disabled={running}
          >
            {cs.upload.close}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={running || checking || readyRows.length === 0}
          >
            {readyRows.length === 0
              ? cs.upload.startNone
              : fill(cs.upload.start, {
                  files: plural(readyRows.length, 'soubor', 'soubory', 'souborů'),
                })}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
