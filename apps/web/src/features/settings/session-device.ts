import { UAParser } from 'ua-parser-js'

export type SessionDeviceKind = 'desktop' | 'mobile' | 'tablet'

export type SessionDevice = {
  kind: SessionDeviceKind
  operatingSystem: string
  application: string
}

/**
 * Reads the operating system, browser and device class from a session's
 * stored user agent. Better Auth keeps only the raw header, and parsing it
 * correctly across browsers needs a maintained ruleset.
 */
export function describeSessionDevice(
  userAgent: string | null | undefined,
): SessionDevice {
  const { os, browser, device } = UAParser(userAgent ?? '')
  return {
    kind:
      device.type === 'mobile' || device.type === 'tablet'
        ? device.type
        : 'desktop',
    operatingSystem: os.name ?? 'Unknown',
    application: browser.name ?? 'Unknown',
  }
}
