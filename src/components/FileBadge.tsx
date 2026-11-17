import { cs } from '~/copy/cs'

interface Kind {
  kind: 'pdf' | 'image'
  name: string
  /** What the sheet says: the ending of such a file. */
  mark: string
}

const KINDS: Record<string, Kind> = {
  'application/pdf': { kind: 'pdf', name: cs.library.pdfFile, mark: 'PDF' },
  'image/jpeg': { kind: 'image', name: cs.library.imageFile, mark: 'JPG' },
  'image/png': { kind: 'image', name: cs.library.imageFile, mark: 'PNG' },
}

interface FileBadgeProps {
  /** `null` while the kind of the file is not known yet. */
  mimeType: string | null
  /** A smaller sheet, for a line of text. */
  small?: boolean
}

/**
 * The kind of a file as a small tinted sheet that carries the file ending.
 * Colour repeats what the sheet says, and the kind is also there in words
 * for assistive technology.
 */
export function FileBadge({ mimeType, small = false }: Readonly<FileBadgeProps>) {
  const known = mimeType === null ? undefined : KINDS[mimeType]
  const kind = known?.kind ?? 'unknown'
  return (
    <span
      className={`file-badge file-badge--${kind}${small ? ' file-badge--small' : ''}`}
      title={known?.name}
    >
      <span aria-hidden="true">{known?.mark ?? '?'}</span>
      {known === undefined ? null : <span className="visually-hidden">{known.name}</span>}
    </span>
  )
}
