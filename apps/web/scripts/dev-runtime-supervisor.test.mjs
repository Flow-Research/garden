import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { superviseDevRuntime } from './dev-runtime-supervisor.mjs'

function child() {
  return new EventEmitter()
}

describe('dev runtime supervisor', () => {
  it('relaunches an unexpected non-zero exit without treating it as user shutdown', () => {
    const children = [child(), child()]
    const launch = vi.fn(() => children.shift())
    const scheduled = []
    const onExit = vi.fn()
    const onSignal = vi.fn()

    superviseDevRuntime({
      launch,
      schedule: (callback) => scheduled.push(callback),
      onRestart: vi.fn(),
      onExit,
      onSignal,
    })

    children.length = 2
    launch.mock.results[0].value.emit('exit', 1, null)
    expect(scheduled).toHaveLength(1)
    scheduled[0]()

    expect(launch).toHaveBeenCalledTimes(2)
    expect(onExit).not.toHaveBeenCalled()
    expect(onSignal).not.toHaveBeenCalled()
  })

  it('forwards explicit signals and stops after the bounded restart budget', () => {
    const signalled = child()
    const onSignal = vi.fn()
    superviseDevRuntime({
      launch: () => signalled,
      schedule: vi.fn(),
      onRestart: vi.fn(),
      onExit: vi.fn(),
      onSignal,
    })
    signalled.emit('exit', null, 'SIGTERM')
    expect(onSignal).toHaveBeenCalledWith('SIGTERM')

    const exhausted = child()
    const onExit = vi.fn()
    superviseDevRuntime({
      launch: () => exhausted,
      schedule: vi.fn(),
      onRestart: vi.fn(),
      onExit,
      onSignal: vi.fn(),
      maxUnexpectedRestarts: 0,
    })
    exhausted.emit('exit', 1, null)
    expect(onExit).toHaveBeenCalledWith(1)
  })

  it('stops its active child when the parent receives a shutdown signal', () => {
    const active = Object.assign(child(), { kill: vi.fn() })
    const onSignal = vi.fn()
    const supervisor = superviseDevRuntime({
      launch: () => active,
      schedule: vi.fn(),
      onRestart: vi.fn(),
      onExit: vi.fn(),
      onSignal,
    })

    supervisor.stop('SIGINT')
    expect(active.kill).toHaveBeenCalledWith('SIGINT')
    active.emit('exit', null, 'SIGINT')
    expect(onSignal).toHaveBeenCalledWith('SIGINT')
  })
})
