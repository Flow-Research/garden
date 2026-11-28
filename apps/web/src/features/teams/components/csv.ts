/** Quotes one CSV cell so commas, quotes and newlines survive. */
export const csvCell = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`

/** Hands the CSV to the browser as a file download. */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
