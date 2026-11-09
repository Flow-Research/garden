import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechInput } from './speech-input'

describe('SpeechInput recording fallback', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('releases the microphone when unmounted during the permission prompt', async () => {
    const stopTrack = vi.fn()
    let grant: (stream: MediaStream) => void = () => {}
    vi.stubGlobal('MediaRecorder', class {})
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            grant = resolve
          }),
      },
    })

    const { unmount } = render(
      <SpeechInput onAudioRecorded={vi.fn(async () => '')} />,
    )
    fireEvent.click(screen.getByRole('button'))
    unmount()

    grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)
    await Promise.resolve()
    await Promise.resolve()

    expect(stopTrack).toHaveBeenCalled()
  })
})
