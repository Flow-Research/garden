/**
 * Display formatting for the Files & Folders surface. The Penpot table shows
 * "07 July, 2024" / "02:23 AM" style columns and "24 KB" sizes. Relative times
 * ("5m ago") come from the shared timeAgo in @garden/core/format.
 */

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

/**
 * Renders the Penpot "Date uploaded" format ("07 July, 2024"). Plain en-GB
 * output omits the comma the design shows, so the parts are rejoined here.
 */
export function formatUploadedDate(iso: string | undefined): string {
  if (iso === undefined) return '—'
  const parts = dateFormatter.formatToParts(new Date(iso))
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${valueOf('day')} ${valueOf('month')}, ${valueOf('year')}`
}

/**
 * Renders the Penpot "Time uploaded" format ("02:23 AM"): 12-hour clock with
 * an AM/PM suffix, matching the folder table reference.
 */
export function formatUploadedTime(iso: string | undefined): string {
  if (iso === undefined) return '—'
  return timeFormatter.format(new Date(iso))
}

export function formatFileSize(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) return '—'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  const kb = sizeBytes / 1024
  if (kb < 1024) return `${kb < 10 ? Number(kb.toFixed(1)) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? Number(mb.toFixed(1)) : Math.round(mb)} MB`
}

/**
 * Middle-ellipsizes long file names so the extension stays visible in fixed
 * containers ("quarterly-report…final.pdf"). CSS `truncate` alone drops the
 * tail, which hides the type the user needs to see.
 */
export function truncateMiddle(text: string, maxLength = 40): string {
  if (text.length <= maxLength) return text
  const head = Math.ceil((maxLength - 1) / 2)
  const tail = Math.floor((maxLength - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

/**
 * CSV cell for a user-controlled file name. Beyond quote-escaping, a name
 * beginning with =, +, -, or @ is interpreted as a formula when the export
 * opens in Excel/Sheets (CSV injection) — prefix it with a single quote.
 */
export function csvFileNameCell(name: string): string {
  const neutralized = /^[=+\-@]/.test(name) ? `'${name}` : name
  return `"${neutralized.replaceAll('"', '""')}"`
}
