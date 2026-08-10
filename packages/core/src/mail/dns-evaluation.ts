/**
 * Derived from OpenShip
 * `apps/api/src/modules/mail/admin/dns-scan.service.ts` at commit
 * 738946188e7c329477a4bbcf9c58dc1451393798 (Apache-2.0).
 *
 * Modified for Garden: network and SSH state access were removed; Effect v4
 * Schemas now define provider-neutral expected records, public observations,
 * and evaluation results. Providers resolve DNS elsewhere and call this pure
 * evaluator with the observed answer.
 */

import { Schema } from 'effect'
import { NonEmptyString } from './values.js'

export const MailDnsRecordType = Schema.Literals([
  'A',
  'AAAA',
  'MX',
  'TXT',
  'CNAME',
  'PTR',
])
export type MailDnsRecordType = typeof MailDnsRecordType.Type

export const MailDnsRecordKind = Schema.Literals([
  'a',
  'aaaa',
  'mx',
  'spf',
  'dkim',
  'dmarc',
  'cname',
  'ptr',
  'txt',
])
export type MailDnsRecordKind = typeof MailDnsRecordKind.Type

export const MailDnsCheckStatus = Schema.Literals([
  'pass',
  'warn',
  'fail',
  'unknown',
])
export type MailDnsCheckStatus = typeof MailDnsCheckStatus.Type

/** Provider-declared DNS state against which a public observation is judged. */
export const MailDnsExpectedRecord = Schema.Struct({
  key: NonEmptyString,
  kind: MailDnsRecordKind,
  name: NonEmptyString,
  value: NonEmptyString,
  required: Schema.Boolean,
})
export interface MailDnsExpectedRecord extends Schema.Schema.Type<
  typeof MailDnsExpectedRecord
> {}

/**
 * Raw resolver answer. Each outer entry is one DNS record; each inner entry is
 * its ordered character-string chunks. Non-TXT records normally have one chunk.
 */
export const MailDnsObservation = Schema.TaggedUnion({
  Answered: {
    recordType: MailDnsRecordType,
    records: Schema.Array(Schema.Array(Schema.String)),
  },
  Missing: {
    recordType: MailDnsRecordType,
  },
  Failed: {
    recordType: MailDnsRecordType,
    message: NonEmptyString,
  },
})
export type MailDnsObservation = typeof MailDnsObservation.Type

export const MailDnsEvaluationInput = Schema.Struct({
  expected: MailDnsExpectedRecord,
  observation: MailDnsObservation,
})
export interface MailDnsEvaluationInput extends Schema.Schema.Type<
  typeof MailDnsEvaluationInput
> {}

/** Stable result consumed by provider health and, later, settings UI. */
export const MailDnsCheck = Schema.Struct({
  key: NonEmptyString,
  kind: MailDnsRecordKind,
  name: NonEmptyString,
  recordType: MailDnsRecordType,
  status: MailDnsCheckStatus,
  expected: Schema.String,
  actual: Schema.String,
  message: NonEmptyString,
})
export interface MailDnsCheck extends Schema.Schema.Type<typeof MailDnsCheck> {}

const DMARC_VERSION_TAG = /^[vV][ \t]*=[ \t]*DMARC1(?:[ \t;]|$)/

/** Maps semantic mail checks to the DNS wire type their resolver must query. */
function recordTypeForKind(kind: MailDnsRecordKind): MailDnsRecordType {
  switch (kind) {
    case 'a':
      return 'A'
    case 'aaaa':
      return 'AAAA'
    case 'mx':
      return 'MX'
    case 'cname':
      return 'CNAME'
    case 'ptr':
      return 'PTR'
    case 'spf':
    case 'dkim':
    case 'dmarc':
    case 'txt':
      return 'TXT'
  }
}

const joinChunks = (chunks: ReadonlyArray<string>): string => chunks.join('')

const joinedRecords = (
  records: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<string> => records.map(joinChunks)

const trimTrailingDot = (value: string): string =>
  value.endsWith('.') ? value.slice(0, -1) : value

const normalizedTarget = (value: string): string =>
  trimTrailingDot(value.trim()).toLowerCase()

const normalizedText = (value: string): string => value.replace(/\s+/g, '')

const displayedRecords = (records: ReadonlyArray<string>): string =>
  records.join(' | ')

/** Creates one schema-owned check while keeping repeated identity fields fixed. */
function makeCheck(
  expected: MailDnsExpectedRecord,
  recordType: MailDnsRecordType,
  status: MailDnsCheckStatus,
  actual: string,
  message: string,
): MailDnsCheck {
  return MailDnsCheck.make({
    key: expected.key,
    kind: expected.kind,
    name: expected.name,
    recordType,
    status,
    expected: expected.value,
    actual,
    message,
  })
}

/** Missing optional records warn; only missing required records fail. */
function missingCheck(
  expected: MailDnsExpectedRecord,
  recordType: MailDnsRecordType,
): MailDnsCheck {
  return makeCheck(
    expected,
    recordType,
    expected.required ? 'fail' : 'warn',
    '',
    expected.required
      ? `${recordType} record is missing.`
      : `${recordType} record is not published; this record is optional.`,
  )
}

/** Evaluates SPF while retaining OpenShip's tolerance for additional mechanisms. */
function evaluateSpf(
  expected: MailDnsExpectedRecord,
  records: ReadonlyArray<string>,
): MailDnsCheck {
  const spfRecords = records.filter((record) => /^v=spf1\b/i.test(record))
  if (spfRecords.length === 0) return missingCheck(expected, 'TXT')
  if (spfRecords.length > 1) {
    return makeCheck(
      expected,
      'TXT',
      'fail',
      displayedRecords(spfRecords),
      'Multiple SPF records found; publish exactly one v=spf1 record.',
    )
  }

  const actual = spfRecords[0] ?? ''
  const expectedTokens = expected.value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .slice(1)
  const actualTokens = new Set(
    actual.toLowerCase().trim().split(/\s+/).slice(1),
  )
  const matches = expectedTokens.every((token) => actualTokens.has(token))
  return makeCheck(
    expected,
    'TXT',
    matches ? 'pass' : 'warn',
    actual,
    matches
      ? 'SPF record contains every expected mechanism.'
      : 'SPF record exists but does not contain every expected mechanism.',
  )
}

/** Evaluates DMARC record cardinality using the RFC version-tag rules from OpenShip. */
function evaluateDmarc(
  expected: MailDnsExpectedRecord,
  records: ReadonlyArray<string>,
): MailDnsCheck {
  const dmarcRecords = records.filter((record) =>
    DMARC_VERSION_TAG.test(record),
  )
  if (dmarcRecords.length === 0) return missingCheck(expected, 'TXT')
  if (dmarcRecords.length > 1) {
    return makeCheck(
      expected,
      'TXT',
      'fail',
      displayedRecords(dmarcRecords),
      'Multiple DMARC records found; publish exactly one v=DMARC1 record.',
    )
  }
  return makeCheck(
    expected,
    'TXT',
    'pass',
    dmarcRecords[0] ?? '',
    'DMARC policy is published.',
  )
}

/** Compares DKIM keys across both standard and split-record TXT chunk shapes. */
function evaluateDkim(
  expected: MailDnsExpectedRecord,
  records: ReadonlyArray<string>,
): MailDnsCheck {
  if (records.length === 0) return missingCheck(expected, 'TXT')
  const wanted = normalizedText(expected.value)
  const matches =
    records.some((record) => normalizedText(record) === wanted) ||
    normalizedText(records.join('')) === wanted
  return makeCheck(
    expected,
    'TXT',
    matches ? 'pass' : 'warn',
    displayedRecords(records),
    matches
      ? 'DKIM TXT matches the expected public key.'
      : 'DKIM TXT exists but does not match the expected public key.',
  )
}

/** Compares ordinary values, normalizing DNS target dots where applicable. */
function evaluateValue(
  expected: MailDnsExpectedRecord,
  recordType: MailDnsRecordType,
  records: ReadonlyArray<string>,
): MailDnsCheck {
  if (records.length === 0) return missingCheck(expected, recordType)
  const matches =
    recordType === 'MX' || recordType === 'CNAME' || recordType === 'PTR'
      ? records.some(
          (record) =>
            normalizedTarget(record) === normalizedTarget(expected.value),
        )
      : recordType === 'AAAA'
        ? records.some(
            (record) =>
              record.trim().toLowerCase() ===
              expected.value.trim().toLowerCase(),
          )
        : records.some((record) => record.trim() === expected.value.trim())
  return makeCheck(
    expected,
    recordType,
    matches ? 'pass' : 'warn',
    displayedRecords(records),
    matches
      ? `${recordType} record matches the expected value.`
      : `${recordType} record exists but does not match the expected value.`,
  )
}

/**
 * Evaluates one provider-neutral public observation. Resolver failures remain
 * unknown, absent answers respect requiredness, and invalid SPF/DMARC
 * cardinality remains a hard failure.
 */
export function evaluateMailDnsRecord(
  input: MailDnsEvaluationInput,
): MailDnsCheck {
  const { expected, observation } = input
  const recordType = recordTypeForKind(expected.kind)
  if (observation.recordType !== recordType) {
    return makeCheck(
      expected,
      recordType,
      'unknown',
      '',
      `Resolver returned ${observation.recordType} while ${recordType} was expected.`,
    )
  }
  if (observation._tag === 'Failed') {
    return makeCheck(
      expected,
      recordType,
      'unknown',
      '',
      `Lookup failed: ${observation.message}`,
    )
  }
  if (observation._tag === 'Missing') {
    return missingCheck(expected, recordType)
  }

  const records = joinedRecords(observation.records)
  switch (expected.kind) {
    case 'spf':
      return evaluateSpf(expected, records)
    case 'dmarc':
      return evaluateDmarc(expected, records)
    case 'dkim':
      return evaluateDkim(expected, records)
    case 'a':
    case 'aaaa':
    case 'mx':
    case 'cname':
    case 'ptr':
    case 'txt':
      return evaluateValue(expected, recordType, records)
  }
}

/** Evaluates a complete provider snapshot without introducing resolver I/O. */
export function evaluateMailDnsRecords(
  inputs: ReadonlyArray<MailDnsEvaluationInput>,
): ReadonlyArray<MailDnsCheck> {
  return inputs.map(evaluateMailDnsRecord)
}
