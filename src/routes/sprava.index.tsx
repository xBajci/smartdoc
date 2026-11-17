import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { DebugPanel } from '~/admin/DebugPanel'
import { EditDocumentDialog } from '~/admin/EditDocumentDialog'
import { UploadDialog } from '~/admin/UploadDialog'
import { formatDate, formatSize } from '~/archive/format'
import { DEFAULT_PAGE_SIZE, defaultOrder } from '~/archive/query'
import { archive, useArchive } from '~/archive/store'
import type {
  ArchiveDocument,
  DocumentPage,
  DocumentStatus,
  SortOrder,
  YearFilter,
} from '~/archive/types'
import { CategoryTab } from '~/components/CategoryTab'
import { Dialog } from '~/components/Dialog'
import { FileBadge } from '~/components/FileBadge'
import { Icon } from '~/components/Icon'
import { ListFoot } from '~/components/ListFoot'
import { SortHeader } from '~/components/SortHeader'
import { StatusBadge } from '~/components/StatusBadge'
import { useSidePanel } from '~/components/useSidePanel'
import { cs, fill } from '~/copy/cs'
import { CategoryPills } from '~/library/CategoryPills'
import { Viewer } from '~/viewer/Viewer'

export const Route = createFileRoute('/sprava/')({
  // `nahrat` asks for the upload window; the header's "Nahrávání" sets it.
  validateSearch: (search: Record<string, unknown>): { nahrat?: true } =>
    search.nahrat === true || search.nahrat === 'true' ? { nahrat: true } : {},
  component: AdminDocuments,
})

const STATUSES: readonly DocumentStatus[] = ['queued', 'processing', 'ready', 'failed']

/** Width of the debug panel in pixels; the divider moves it between the two limits. */
const DEBUG_WIDTH = { min: 360, max: 900 }

/** How long the search waits after the last key before it asks the server. */
const SEARCH_DELAY_MS = 250

function AdminDocuments() {
  const { categories, revision } = useArchive()
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | ''>('')
  const [chosenCategory, setChosenCategory] = useState<string>()
  const [year, setYear] = useState<YearFilter>()
  /** The document whose processing the debug panel shows. */
  const [debugId, setDebugId] = useState<string | null>(null)
  /** On a narrow screen the debug panel covers the page and opens with a click on a document. */
  const [debugOpen, setDebugOpen] = useState(false)
  const { workspace, style, divider } = useSidePanel({
    ...DEBUG_WIDTH,
    panel: '.debug',
    label: cs.debug.resize,
  })
  const [message, setMessage] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  /** What the server is asked for; follows `typed` when the typing stops. */
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  /** The order the administrator chose by a column head; none means the starting one. */
  const [chosenOrder, setChosenOrder] = useState<SortOrder>()
  /** The page of documents the server returned; `null` until the first answer. */
  const [list, setList] = useState<DocumentPage | null>(null)

  useEffect(() => {
    const waiting = setTimeout(() => {
      setQuery(typed.trim())
      setPage(1)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(waiting)
  }, [typed])

  // Read again on every change of the archive (`revision`), so a row follows
  // its document through processing.
  useEffect(() => {
    let current = true
    archive
      .adminDocuments({
        q: query === '' ? undefined : query,
        stav: statusFilter === '' ? undefined : statusFilter,
        kategorie: chosenCategory,
        rok: year,
        razeni: chosenOrder,
        stranka: page,
        pocet: pageSize,
      })
      .then(
        (answer) => {
          if (!current || answer === null) return
          setList(answer)
          // The server answers with the last page when the asked one is gone.
          setPage(answer.page)
        },
        () => {
          if (current) setMessage(cs.admin.actionFailed)
        },
      )
    return () => {
      current = false
    }
  }, [revision, query, statusFilter, chosenCategory, year, page, pageSize, chosenOrder])
  const [editing, setEditing] = useState<ArchiveDocument | null>(null)
  const [removing, setRemoving] = useState<ArchiveDocument | null>(null)
  const [uploading, setUploading] = useState(false)
  const { nahrat } = Route.useSearch()
  const navigate = Route.useNavigate()
  useEffect(() => {
    if (nahrat !== true) return
    setUploading(true)
    void navigate({ search: {}, replace: true })
  }, [nahrat, navigate])
  /** The document shown over the page. */
  const [viewing, setViewing] = useState<ArchiveDocument | null>(null)
  /** Documents this browser asked to process and has no answer for yet. */
  const [running, setRunning] = useState<readonly string[]>([])

  function reprocess({ id, title }: ArchiveDocument) {
    setRunning((current) => [...current, id])
    archive
      .processDocument(id)
      .then(
        () => setMessage(fill(cs.admin.reprocessDone, { title })),
        () => setMessage(cs.admin.actionFailed),
      )
      .finally(() => setRunning((current) => current.filter((other) => other !== id)))
  }

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const shown = list?.documents ?? []
  const failedCount = list?.failedCount ?? 0
  const sorting = {
    order: chosenOrder ?? defaultOrder(query),
    onSort: (order: SortOrder) => {
      setChosenOrder(order)
      setPage(1)
    },
  }

  const pills = [
    {
      id: undefined,
      name: cs.library.allCategories,
      count: Object.values(list?.categoryCounts ?? {}).reduce((sum, count) => sum + count, 0),
    },
    ...categories.map((category) => ({
      id: category.id,
      name: category.name,
      count: list?.categoryCounts[category.id] ?? 0,
    })),
  ]

  return (
    <main
      ref={workspace}
      className={
        debugOpen ? 'workspace workspace--admin workspace--chat-open' : 'workspace workspace--admin'
      }
      style={style}
    >
      {/* A document is viewed as in the library: it takes the place of the list, which stays as it was. */}
      <section
        className="panel library"
        aria-labelledby="admin-documents-title"
        hidden={viewing !== null}
      >
        {/* The same tools as the library has: search, then categories and selects. */}
        <div className="lib admin-list">
          <h1 id="admin-documents-title" className="visually-hidden">
            {cs.admin.navDocuments}
          </h1>
          <div className="lib__top">
            <label className="lib-search">
              <Icon name="search" size={18} />
              <span className="visually-hidden">{cs.admin.searchLabel}</span>
              <input
                type="search"
                value={typed}
                placeholder={cs.admin.searchPlaceholder}
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setUploading(true)}
            >
              <Icon name="upload" />
              {cs.admin.uploadAction}
            </button>
          </div>

          <div className="lib__filters">
            <CategoryPills
              pills={pills}
              chosenId={chosenCategory}
              onChoose={(id) => {
                setChosenCategory(id)
                setPage(1)
              }}
            />
            <div className="lib__selects">
              <label className="pill-select">
                <span aria-hidden="true">{cs.admin.statusFilterLabel}</span>
                <select
                  aria-label={cs.admin.statusFilterLabel}
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as DocumentStatus | '')
                    setPage(1)
                  }}
                >
                  <option value="">{cs.admin.statusAll}</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {cs.status[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pill-select">
                <span aria-hidden="true">{cs.library.yearShort}</span>
                <select
                  aria-label={cs.library.yearLabel}
                  value={year === undefined ? '' : String(year)}
                  onChange={(event) => {
                    const value = event.target.value
                    setYear(value === '' ? undefined : value === 'neznamy' ? value : Number(value))
                    setPage(1)
                  }}
                >
                  <option value="">{cs.library.allYears}</option>
                  {(list?.years ?? []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                  <option value="neznamy">{cs.library.unknownYear}</option>
                </select>
              </label>
            </div>
          </div>

          {failedCount === 0 ? null : (
            <p className="attention">
              <Icon name="alert" />
              {fill(cs.admin.needsAttention, { count: failedCount })}
            </p>
          )}
          <p className="flash" role="status">
            {message}
          </p>

          {list === null ? (
            <p className="notice" role="status">
              {cs.admin.loading}
            </p>
          ) : list.archiveTotal === 0 ? (
            <p className="notice">{cs.admin.documentsEmpty}</p>
          ) : list.total === 0 ? (
            <p className="notice" role="status">
              {cs.admin.noMatch}
            </p>
          ) : (
            <>
              <table className="document-table admin-table">
                <thead>
                  <tr>
                    <SortHeader
                      label={cs.admin.columnDocument}
                      first="nazev"
                      second="nazev-z"
                      {...sorting}
                    />
                    <th scope="col">{cs.admin.columnStatus}</th>
                    <SortHeader
                      label={cs.admin.columnCategory}
                      first="kategorie"
                      second="kategorie-z"
                      {...sorting}
                    />
                    <SortHeader
                      label={cs.admin.columnAdded}
                      first="nove"
                      second="stare"
                      {...sorting}
                    />
                    <th scope="col">{cs.admin.columnActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((document) => (
                    <tr
                      key={document.id}
                      className="admin-table__row"
                      aria-selected={debugId === document.id}
                      onClick={(event) => {
                        // The actions of the row do their own work.
                        if (
                          event.target instanceof Element &&
                          event.target.closest('.row-actions')
                        ) {
                          return
                        }
                        setDebugId(document.id)
                        setDebugOpen(true)
                      }}
                    >
                      <td>
                        <div className="document-row">
                          <FileBadge mimeType={document.mimeType} />
                          <div>
                            <button
                              type="button"
                              className="admin-table__title"
                              aria-label={`${cs.debug.show}: ${document.title}`}
                            >
                              {document.title}
                            </button>
                            <p className="document-row__description">
                              {document.originalFilename} · {formatSize(document.sizeBytes)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusBadge
                          status={running.includes(document.id) ? 'processing' : document.status}
                        />
                        {document.status === 'ready' && document.hasText === false ? (
                          <p className="status-note">
                            <Icon name="noText" size={15} />
                            {cs.status.noText}
                          </p>
                        ) : null}
                        {document.errorReason === null ? null : (
                          <p className="status-note status-note--error">{document.errorReason}</p>
                        )}
                      </td>
                      <td>
                        <CategoryTab category={categoryById.get(document.categoryId)} />
                      </td>
                      <td>{formatDate(document.addedAt)}</td>
                      <td>
                        <div className="row-actions row-actions--icons">
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => {
                              setViewing(document)
                              // The debug panel next to the document is about the same document.
                              setDebugId(document.id)
                            }}
                            aria-label={`${cs.admin.view}: ${document.title}`}
                            data-tip={cs.admin.view}
                          >
                            <Icon name="eye" size={18} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => setEditing(document)}
                            aria-label={`${cs.admin.edit}: ${document.title}`}
                            data-tip={cs.admin.edit}
                          >
                            <Icon name="edit" size={18} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => reprocess(document)}
                            disabled={
                              document.status === 'processing' || running.includes(document.id)
                            }
                            aria-label={`${cs.admin.reprocess}: ${document.title}`}
                            data-tip={cs.admin.reprocess}
                          >
                            <Icon name="retry" size={18} />
                          </button>
                          <button
                            type="button"
                            className="icon-button icon-button--danger"
                            onClick={() => setRemoving(document)}
                            aria-label={`${cs.admin.remove}: ${document.title}`}
                            data-tip={cs.admin.remove}
                          >
                            <Icon name="trash" size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ListFoot
                total={list.total}
                shown={list.documents.length}
                page={list.page}
                pageCount={list.pageCount}
                pageSize={list.pageSize}
                onPage={setPage}
                onPageSize={(size) => {
                  setPageSize(size)
                  setPage(1)
                }}
              />
            </>
          )}

          {editing === null ? null : (
            <EditDocumentDialog
              document={editing}
              categories={categories}
              onClose={(saved) => {
                setEditing(null)
                if (saved) setMessage(cs.admin.saved)
              }}
            />
          )}

          {uploading ? (
            <UploadDialog
              onClose={(storedIds) => {
                setUploading(false)
                // Only now, with the window gone, the list starts to show documents being read.
                archive.processInBackground(storedIds)
              }}
            />
          ) : null}

          {removing === null ? null : (
            <Dialog title={cs.admin.removeTitle} onClose={() => setRemoving(null)}>
              <p>{fill(cs.admin.removeText, { title: removing.title })}</p>
              <div className="dialog__actions">
                <button type="button" className="button" onClick={() => setRemoving(null)}>
                  {cs.admin.cancel}
                </button>
                <button
                  type="button"
                  className="button button--danger-solid"
                  onClick={() => {
                    const { id, title } = removing
                    setRemoving(null)
                    archive.removeDocument(id).then(
                      () => setMessage(fill(cs.admin.removed, { title })),
                      () => setMessage(cs.admin.actionFailed),
                    )
                  }}
                >
                  {cs.admin.removeConfirm}
                </button>
              </div>
            </Dialog>
          )}
        </div>
      </section>

      {viewing === null ? null : (
        <Viewer
          key={viewing.id}
          document={viewing}
          requestedPage={undefined}
          onBack={() => setViewing(null)}
        />
      )}

      <div {...divider} />
      <DebugPanel documentId={debugId} revision={revision} onClose={() => setDebugOpen(false)} />
    </main>
  )
}
