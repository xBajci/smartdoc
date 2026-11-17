import type { ArchiveDocument } from '~/archive/types'
import { cs } from '~/copy/cs'
import { Icon, type IconName } from './Icon'

const ICONS: Record<ArchiveDocument['status'], IconName> = {
  queued: 'clock',
  processing: 'processing',
  ready: 'check',
  failed: 'alert',
}

/** State is always icon plus words, never colour alone. */
export function StatusBadge({ status }: Readonly<{ status: ArchiveDocument['status'] }>) {
  return (
    <span className={`status status--${status}`}>
      <Icon name={ICONS[status]} size={15} />
      {cs.status[status]}
    </span>
  )
}
