import { describe, expect, it } from 'vitest'
import { describeSessionDevice } from './session-device'

describe('describeSessionDevice', () => {
  it('reads desktop operating system and browser', () => {
    expect(
      describeSessionDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toEqual({
      kind: 'desktop',
      operatingSystem: 'macOS',
      application: 'Chrome',
    })
  })

  it('marks phones as mobile', () => {
    expect(
      describeSessionDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toMatchObject({ kind: 'mobile', operatingSystem: 'iOS' })
  })

  it('labels a missing user agent as unknown', () => {
    expect(describeSessionDevice(null)).toEqual({
      kind: 'desktop',
      operatingSystem: 'Unknown',
      application: 'Unknown',
    })
  })
})
