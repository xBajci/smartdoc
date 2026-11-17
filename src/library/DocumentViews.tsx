import { Link } from '@tanstack/react-router'
import { documentDate, formatDate, formatLongDate, plural } from '~/archive/format'
import {
  shownDescription,
  type ArchiveDocument,
  type Category,
  type FoundDocument,
  type SortOrder,
} from '~/archive/types'
import { CategoryTab } from '~/components/CategoryTab'
import { FileBadge } from '~/components/FileBadge'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'
import { PdfThumbnail } from '~/viewer/PdfThumbnail'
import { highlight } from './highlight'

interface ViewProps {
  documents: readonly FoundDocument[]
  categories: ReadonlyMap<string, Category>
  query: string | undefined
}

/** Opens the viewer in place; the rest of the address (filters, view) stays. */
function DocumentLink({
  document,
  query,
}: Readonly<{ document: ArchiveDocument; query: string | undefined }>) {
  return (
    <Link
      to="/"
      search={(previous) => ({ ...previous, doc: document.id, strana: undefined })}
      className="document-link"
      resetScroll={false}
    >
      {highlight(document.title, query)}
    </Link>
  )
}

/** The place in the content where the searched words were found. */
function Snippet({
  document,
  query,
}: Readonly<{ document: FoundDocument; query: string | undefined }>) {
  if (document.snippet === null) return null
  return (
    <p className="document-snippet">
      <span className="document-snippet__label">{cs.library.snippetLabel}</span>{' '}
      {highlight(document.snippet, query)}
    </p>
  )
}

interface ListViewProps extends ViewProps {
  order: SortOrder
  onAskAbout: (document: ArchiveDocument) => void
  chosenIds: readonly string[]
}

interface Group {
  /** The day the documents were added; `null` when the list is not ordered by date. */
  day: string | null
  documents: FoundDocument[]
}

/** The date of the document, or the day it was added when it carries none. */
function shownDate(document: FoundDocument): string {
  return documentDate(document)?.label ?? `${cs.library.added} ${formatDate(document.addedAt)}`
}

/**
 * A list ordered by the date of the documents reads as months and years, one
 * ordered by the day of adding as days; any other order is one run of documents.
 */
function groupByDay(documents: readonly FoundDocument[], order: SortOrder): Group[] {
  const dated = order === 'vydane' || order === 'vydane-z'
  if (!dated && order !== 'nove' && order !== 'stare') {
    return [{ day: null, documents: [...documents] }]
  }
  const groups: Group[] = []
  for (const document of documents) {
    const day = dated
      ? (documentDate(document)?.group ?? cs.library.noDate)
      : formatLongDate(document.addedAt)
    const last = groups.at(-1)
    if (last?.day === day) last.documents.push(document)
    else groups.push({ day, documents: [document] })
  }
  return groups
}

export function ListView({
  documents,
  categories,
  query,
  order,
  onAskAbout,
  chosenIds,
}: Readonly<ListViewProps>) {
  return (
    <div className="doc-list">
      {groupByDay(documents, order).map((group) => (
        <section key={group.day ?? 'all'} aria-label={group.day ?? undefined}>
          {group.day === null ? null : (
            <h2 className="doc-group">
              <span>{group.day}</span>
              <span className="doc-group__count">
                {plural(group.documents.length, 'dokument', 'dokumenty', 'dokumentů')}
              </span>
            </h2>
          )}
          <ul>
            {group.documents.map((document) => {
              const chosen = chosenIds.includes(document.id)
              const ask = chosen ? cs.library.askAboutChosen : cs.library.askAbout
              return (
                <li key={document.id} className="doc-row">
                  <FileBadge mimeType={document.mimeType} />
                  <div className="doc-row__text">
                    <DocumentLink document={document} query={query} />
                    <p className="doc-row__description">
                      {highlight(shownDescription(document), query)}
                    </p>
                    <Snippet document={document} query={query} />
                    <p className="doc-row__meta">
                      <span className="doc-row__category">
                        {categories.get(document.categoryId)?.name}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="document-filename">
                        {highlight(document.originalFilename, query)}
                      </span>
                      {/* Under a heading of a day the date would only repeat it. */}
                      {group.day !== null && order !== 'vydane' && order !== 'vydane-z' ? null : (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{shownDate(document)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {/* The row itself opens the document: its name is a link that covers the row. */}
                  <div className="row-actions row-actions--icons doc-row__actions">
                    <a
                      className="icon-button"
                      href={`${document.fileUrl}?stahnout`}
                      download={document.originalFilename}
                      aria-label={`${cs.library.download}: ${document.title}`}
                      data-tip={cs.library.download}
                    >
                      <Icon name="download" size={16} />
                    </a>
                    {/* The arrow points at the chat: it adds the document to those an answer is bound to. */}
                    <button
                      type="button"
                      className={chosen ? 'icon-button icon-button--chosen' : 'icon-button'}
                      aria-pressed={chosen}
                      aria-label={`${ask}: ${document.title}`}
                      data-tip={ask}
                      onClick={() => onAskAbout(document)}
                    >
                      <Icon name={chosen ? 'check' : 'arrow'} size={16} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function PreviewView({ documents, categories, query }: Readonly<ViewProps>) {
  return (
    <ul className="document-previews">
      {documents.map((document) => {
        const label = fill(cs.library.previewAlt, { title: document.title })
        return (
          <li key={document.id} className="preview-card">
            <div className="preview-card__picture">
              {document.format === 'pdf' ? (
                <PdfThumbnail url={document.fileUrl} label={label} />
              ) : (
                // The small copy; the original loads only when the document is opened.
                <img src={document.thumbnailUrl ?? document.fileUrl} alt={label} loading="lazy" />
              )}
            </div>
            <div className="preview-card__body">
              <DocumentLink document={document} query={query} />
              <p className="document-filename">{highlight(document.originalFilename, query)}</p>
              <p className="preview-card__description">
                {highlight(shownDescription(document), query)}
              </p>
              <Snippet document={document} query={query} />
              <div className="tile__meta">
                <CategoryTab category={categories.get(document.categoryId)} />
                <span>{shownDate(document)}</span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
