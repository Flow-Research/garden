import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { Result } from 'better-result'
import { z } from 'zod'
import { decideCsvRows } from '../examples/chat-tasks.ts'
import { GardenEvalError } from '../runner/errors.ts'

export type DecideWorkbookInspection = {
  digest: `sha256:${string}`
  sheetNames: string[]
  opened: boolean
  rawDataPreserved: boolean
  verificationMatches: boolean
  analysisKeepsCorrectionSeparate: boolean
}

/** Converts workbook cell values to stable text for fixture comparisons. */
function cellText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  if (typeof value !== 'object' || value === null) return ''

  if ('text' in value && typeof value.text === 'string') return value.text
  if ('result' in value) return cellText(value.result)
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText
      .flatMap((part) => {
        const parsed = zTextBlock.safeParse(part)
        return parsed.success ? [parsed.data.text] : []
      })
      .join('')
  }
  return ''
}

const zTextBlock = z.object({ text: z.string() })

/** Reads visible worksheet rows while dropping trailing formatted empty cells. */
function worksheetRows(worksheet: ExcelJS.Worksheet | undefined): string[][] {
  if (!worksheet) return []
  const rows: string[][] = []
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = Array.from({ length: row.cellCount }, (_, index) =>
      cellText(row.getCell(index + 1).value),
    )
    while (cells.at(-1) === '') cells.pop()
    if (cells.some((cell) => cell !== '')) rows.push(cells)
  })
  return rows
}

/**
 * Opens Decide's output and checks its sheets against the synthetic CSV.
 * Before this grader, Garden could confirm only that a file link existed.
 * References: the Decide task contract and the `exceljs` workbook reader.
 */
export async function inspectDecideWorkbook(
  bytes: Uint8Array,
): Promise<DecideWorkbookInspection> {
  const digest: `sha256:${string}` = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const workbook = new ExcelJS.Workbook()
  const workbookBytes = Uint8Array.from(bytes)
  const loadResult = await Result.tryPromise({
    try: () => workbook.xlsx.load(workbookBytes.buffer as ArrayBuffer),
    catch: () =>
      new GardenEvalError({
        stage: 'grading',
        code: 'invalid_workbook',
        message: 'Decide returned a workbook that ExcelJS could not open.',
        invalidReason: 'grader_execution_failed',
      }),
  })

  return loadResult.match<DecideWorkbookInspection>({
    ok: (): DecideWorkbookInspection => {
      const sheetNames = workbook.worksheets.map((sheet) => sheet.name)
      const rawRows = worksheetRows(workbook.getWorksheet('Raw Data'))
      const verificationRows = worksheetRows(
        workbook.getWorksheet('Verification'),
      )
      const expectedRows = decideCsvRows.map((row) => [...row])
      const rawDataPreserved =
        rawRows.length === expectedRows.length &&
        rawRows.every(
          (row, index) =>
            row.length === expectedRows[index]?.length &&
            expectedRows[index]?.every((cell, cellIndex) =>
              cellMatches(row[cellIndex], cell),
            ) === true,
        )

      const targetRow =
        decideCsvRows.find((row) => row[0] === '2026-03-18') ?? []
      const verificationHasSourceRow = verificationRows.some(
        (row) =>
          row.length === targetRow.length &&
          targetRow.every((cell, index) => cellMatches(row[index], cell)),
      )
      const expectedRegions = [
        ...new Set(decideCsvRows.slice(1).map((row) => row[1])),
      ]
      const verificationMatches =
        verificationHasSourceRow &&
        expectedRegions.every((region) =>
          verificationRows.some((row) => row.includes(region)),
        ) &&
        verificationRows.some(
          (row) =>
            row.some((cell) => /\bast\b/i.test(cell)) &&
            row.some((cell) => /^yes$/i.test(cell.trim())),
        )

      const analysisRows = worksheetRows(workbook.getWorksheet('Analysis'))
      const analysisKeepsCorrectionSeparate =
        hasLabeledValue(analysisRows, /original/i, /\bast\b/i) &&
        hasLabeledValue(analysisRows, /proposed|correction/i, /\bEast\b/i)

      return {
        digest,
        sheetNames,
        opened: true,
        rawDataPreserved,
        verificationMatches,
        analysisKeepsCorrectionSeparate,
      }
    },
    err: (): DecideWorkbookInspection => ({
      digest,
      sheetNames: [],
      opened: false,
      rawDataPreserved: false,
      verificationMatches: false,
      analysisKeepsCorrectionSeparate: false,
    }),
  })
}

/**
 * Finds a labeled value in inline text or table cells. Before this helper, the
 * workbook grader rejected normal separate-column corrections. It now accepts
 * labels and values in one row or adjacent rows. Reference: synthetic Decide
 * workbook contract in `examples/chat-tasks.ts`.
 */
function hasLabeledValue(
  rows: string[][],
  labelPattern: RegExp,
  valuePattern: RegExp,
): boolean {
  return rows.some((row, rowIndex) => {
    const labelIndexes = row.flatMap((cell, index) =>
      labelPattern.test(cell) ? [index] : [],
    )
    const valueIndexes = row.flatMap((cell, index) =>
      valuePattern.test(cell) ? [index] : [],
    )
    if (labelIndexes.length > 0 && valueIndexes.length > 0) return true

    const nextRow = rows[rowIndex + 1]
    return (
      nextRow !== undefined &&
      labelIndexes.some((index) => valuePattern.test(nextRow[index] ?? ''))
    )
  })
}

/** Treats numeric CSV fields and their equivalent Excel number cells equally. */
function cellMatches(value: string | undefined, expected: string): boolean {
  if (value === expected) return true
  const expectedNumber = Number(expected)
  return (
    value !== undefined &&
    expected.trim() !== '' &&
    Number.isFinite(expectedNumber) &&
    Number(value) === expectedNumber
  )
}
