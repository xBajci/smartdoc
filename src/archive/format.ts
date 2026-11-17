const dateFormat = new Intl.DateTimeFormat('cs-CZ', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Prague',
})

/** "2026-11-04T09:30:00Z" → "04. 11. 2026" */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(isoDate))
}

const longDateFormat = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Prague',
})

/** "2026-11-04T09:30:00Z" → "4. listopadu 2026" */
export function formatLongDate(isoDate: string): string {
  return longDateFormat.format(new Date(isoDate))
}

const monthFormat = new Intl.DateTimeFormat('cs-CZ', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const dayFormat = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeZone: 'UTC' })

/**
 * The date of a document as lists show it: the day when it is known, the year
 * when only the year is, and `null` when the document carries no date. `group`
 * is the heading its part of a list ordered by date has.
 */
export function documentDate(document: {
  issuedOn: string | null
  issuedYear: number | null
}): { label: string; group: string } | null {
  if (document.issuedOn !== null) {
    const day = new Date(`${document.issuedOn}T00:00:00Z`)
    return { label: dayFormat.format(day), group: monthFormat.format(day) }
  }
  if (document.issuedYear !== null) {
    const year = String(document.issuedYear)
    return { label: year, group: year }
  }
  return null
}

const sizeFormat = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 })

const usd = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

/** Costs of AI are fractions of a cent, so four decimals. */
export function formatUsd(amount: number): string {
  return usd.format(amount)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} kB`
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`
}

/** Czech plural: 1 dokument, 2–4 dokumenty, 5+ dokumentů. */
export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return `${count} ${one}`
  if (count >= 2 && count <= 4) return `${count} ${few}`
  return `${count} ${many}`
}
