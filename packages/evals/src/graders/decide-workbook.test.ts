import assert from 'node:assert/strict'
import { it } from 'node:test'
import ExcelJS from 'exceljs'
import { decideCsvRows } from '../examples/chat-tasks.ts'
import { inspectDecideWorkbook } from './decide-workbook.ts'

async function workbookBytes(analysisRows: string[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const raw = workbook.addWorksheet('Raw Data')
  decideCsvRows.forEach((row) => raw.addRow([...row]))
  const verification = workbook.addWorksheet('Verification')
  verification.addRow([...decideCsvRows[3]])
  verification.addRow(['North', 'West', 'ast', 'South', 'East'])
  verification.addRow(['ast', 'yes'])
  const analysis = workbook.addWorksheet('Analysis')
  analysisRows.forEach((row) => analysis.addRow(row))
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

it('accepts adjacent correction labels and values', async () => {
  const result = await inspectDecideWorkbook(
    await workbookBytes([
      ['Original', 'ast'],
      ['Proposed correction', 'East'],
    ]),
  )
  assert.equal(result.opened, true)
  assert.equal(result.rawDataPreserved, true)
  assert.equal(result.verificationMatches, true)
  assert.equal(result.analysisKeepsCorrectionSeparate, true)
})

it('rejects a region row that only happens to mention correction', async () => {
  const result = await inspectDecideWorkbook(
    await workbookBytes([
      ['Original', 'ast'],
      ['correction region', 'other', 'East'],
    ]),
  )
  assert.equal(result.analysisKeepsCorrectionSeparate, false)
})
