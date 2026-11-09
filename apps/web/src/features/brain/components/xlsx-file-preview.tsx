import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { brainFileExtractedTextOptions } from '../queries'

interface SpreadsheetSheet {
  name: string
  rows: string[][]
}

/**
 * Parses the Markdown-like worksheet format produced by Brain's XLSX
 * extractor. Each `##` heading starts a sheet and tab characters separate
 * cells within one row.
 */
function parseSpreadsheet(content: string): SpreadsheetSheet[] {
  const sheets: SpreadsheetSheet[] = []
  let currentSheet: SpreadsheetSheet | undefined

  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      if (currentSheet !== undefined) sheets.push(currentSheet)

      currentSheet = {
        name: line.slice(3).trim() || `Sheet ${sheets.length + 1}`,
        rows: [],
      }
      continue
    }

    if (line.trim() === '') continue

    if (currentSheet === undefined) {
      currentSheet = { name: 'Sheet 1', rows: [] }
    }

    currentSheet.rows.push(line.split('\t'))
  }

  if (currentSheet !== undefined) sheets.push(currentSheet)

  return sheets
}

function SpreadsheetGrid({ content }: { content: string }) {
  const sheetControlId = useId()
  const panelId = `${sheetControlId}-panel`
  const sheets = useMemo(() => parseSpreadsheet(content), [content])
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0)
  const selectedSheet = sheets[selectedSheetIndex]

  if (selectedSheet === undefined) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center px-6 text-sm text-muted-foreground">
        This spreadsheet is empty.
      </div>
    )
  }

  const [headerRow, ...bodyRows] = selectedSheet.rows

  const selectSheetFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % sheets.length
    if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + sheets.length) % sheets.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = sheets.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    setSelectedSheetIndex(nextIndex)
    document.getElementById(`${sheetControlId}-tab-${nextIndex}`)?.focus()
  }

  return (
    <div className="flex min-h-[65vh] max-h-[65vh] flex-col bg-background text-foreground">
      <div
        role="tablist"
        aria-label="Spreadsheet sheets"
        className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/20 px-3 pt-2"
      >
        {sheets.map((sheet, index) => {
          const tabId = `${sheetControlId}-tab-${index}`
          return (
            <button
              key={`${sheet.name}-${index}`}
              id={tabId}
              type="button"
              role="tab"
              aria-controls={panelId}
              aria-selected={index === selectedSheetIndex}
              tabIndex={index === selectedSheetIndex ? 0 : -1}
              className={cn(
                'cursor-pointer whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                index === selectedSheetIndex
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setSelectedSheetIndex(index)}
              onKeyDown={(event) => selectSheetFromKeyboard(event, index)}
            >
              {sheet.name}
            </button>
          )
        })}
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${sheetControlId}-tab-${selectedSheetIndex}`}
        className="min-h-0 flex-1 overflow-auto p-4"
      >
        {headerRow === undefined ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            This sheet is empty.
          </p>
        ) : (
          <table
            aria-label={selectedSheet.name}
            className="min-w-full border-collapse text-left text-sm"
          >
            <thead>
              <tr>
                {headerRow.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    scope="col"
                    className="sticky top-0 border bg-muted px-3 py-2 font-medium text-foreground"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border px-3 py-2 text-foreground"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function XlsxFilePreview({ fileId }: { fileId: string }) {
  const contentQuery = useQuery(brainFileExtractedTextOptions(fileId))

  if (contentQuery.isPending) {
    return (
      <div
        role="status"
        className="flex min-h-[65vh] items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner aria-hidden="true" />
        Loading preview...
      </div>
    )
  }

  if (contentQuery.isError) {
    return (
      <div className="flex min-h-[65vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          Could not load preview.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={contentQuery.isFetching}
          onClick={() => void contentQuery.refetch()}
        >
          {contentQuery.isFetching ? 'Trying...' : 'Try again'}
        </Button>
      </div>
    )
  }

  return <SpreadsheetGrid content={contentQuery.data} />
}
