/**
 * Behavioral cases derived from OpenShip
 * `apps/api/test/modules/mail/dns-scan.service.test.ts` at commit
 * 738946188e7c329477a4bbcf9c58dc1451393798 (Apache-2.0).
 * Modified for Garden's provider-neutral, resolver-free Effect contracts.
 */

import { describe, expect, it } from 'vitest'
import {
  evaluateMailDnsRecord,
  MailDnsExpectedRecord,
  MailDnsObservation,
  type MailDnsRecordKind,
  type MailDnsRecordType,
} from './dns-evaluation.js'

const expected = (kind: MailDnsRecordKind, value: string, required = true) =>
  MailDnsExpectedRecord.make({
    key: kind,
    kind,
    name: kind === 'dmarc' ? '_dmarc.example.com' : 'example.com',
    value,
    required,
  })

const answered = (
  recordType: MailDnsRecordType,
  records: ReadonlyArray<ReadonlyArray<string>>,
) => MailDnsObservation.cases.Answered.make({ recordType, records })

describe('evaluateMailDnsRecord', () => {
  it('passes one SPF record containing all expected mechanisms', () => {
    const check = evaluateMailDnsRecord({
      expected: expected('spf', 'v=spf1 mx -all'),
      observation: answered('TXT', [['v=spf1 ip4:203.0.113.4 mx -all']]),
    })

    expect(check.status).toBe('pass')
  })

  it('warns when SPF exists without every expected mechanism', () => {
    const check = evaluateMailDnsRecord({
      expected: expected('spf', 'v=spf1 mx -all'),
      observation: answered('TXT', [['v=spf1 include:example.net -all']]),
    })

    expect(check.status).toBe('warn')
  })

  it('fails multiple SPF records, including case-insensitive versions', () => {
    const check = evaluateMailDnsRecord({
      expected: expected('spf', 'v=spf1 mx -all'),
      observation: answered('TXT', [
        ['V=SPF1 mx -all'],
        ['v=spf1 include:example.net -all'],
      ]),
    })

    expect(check.status).toBe('fail')
    expect(check.message).toMatch(/multiple SPF records/i)
  })

  it('fails multiple RFC-shaped DMARC records but ignores lookalikes', () => {
    const multiple = evaluateMailDnsRecord({
      expected: expected('dmarc', 'v=DMARC1; p=reject'),
      observation: answered('TXT', [
        ['v=DMARC1; p=reject'],
        ['v = DMARC1; p=none'],
      ]),
    })
    const lookalikes = evaluateMailDnsRecord({
      expected: expected('dmarc', 'v=DMARC1; p=reject'),
      observation: answered('TXT', [
        ['v=DMARC1; p=reject'],
        ['v=dmarc1; p=none'],
        ['v=DMARC10; p=none'],
      ]),
    })

    expect(multiple.status).toBe('fail')
    expect(lookalikes.status).toBe('pass')
  })

  it('joins TXT character-string chunks before comparing DKIM keys', () => {
    const key = `v=DKIM1;p=${'A'.repeat(300)}`
    const check = evaluateMailDnsRecord({
      expected: expected('dkim', key),
      observation: answered('TXT', [[key.slice(0, 255), key.slice(255)]]),
    })

    expect(check.status).toBe('pass')
  })

  it('also joins a DKIM key split across separate resolver records', () => {
    const key = `v=DKIM1;p=${'A'.repeat(300)}`
    const check = evaluateMailDnsRecord({
      expected: expected('dkim', key),
      observation: answered('TXT', [[key.slice(0, 255)], [key.slice(255)]]),
    })

    expect(check.status).toBe('pass')
  })

  it.each([
    ['mx', 'MX'],
    ['cname', 'CNAME'],
    ['ptr', 'PTR'],
  ] as const)('normalizes trailing dots for %s targets', (kind, recordType) => {
    const check = evaluateMailDnsRecord({
      expected: expected(kind, 'mail.example.com'),
      observation: answered(recordType, [['mail.example.com.']]),
    })

    expect(check.status).toBe('pass')
  })

  it('fails a missing required record and warns for a missing optional one', () => {
    const required = evaluateMailDnsRecord({
      expected: expected('mx', 'mail.example.com'),
      observation: MailDnsObservation.cases.Missing.make({ recordType: 'MX' }),
    })
    const optional = evaluateMailDnsRecord({
      expected: expected('mx', 'mail.example.com', false),
      observation: MailDnsObservation.cases.Missing.make({ recordType: 'MX' }),
    })

    expect(required.status).toBe('fail')
    expect(optional.status).toBe('warn')
  })

  it('keeps resolver failures unknown rather than calling records missing', () => {
    const check = evaluateMailDnsRecord({
      expected: expected('mx', 'mail.example.com'),
      observation: MailDnsObservation.cases.Failed.make({
        recordType: 'MX',
        message: 'resolver timed out',
      }),
    })

    expect(check.status).toBe('unknown')
    expect(check.message).toContain('resolver timed out')
  })
})
