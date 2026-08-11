/**
 * Owns one local Worker child at a time and relaunches only unexpected non-zero
 * exits. Cloudflare's local Hyperdrive bridge can terminate its Vite host when
 * an origin socket times out; durable local state remains on disk, so a bounded
 * relaunch restores the request surface without hiding a persistent failure.
 */
export function superviseDevRuntime({
  launch,
  schedule,
  onRestart,
  onExit,
  onSignal,
  maxUnexpectedRestarts = 5,
  restartDelayMs = 2_000,
}) {
  let unexpectedRestarts = 0

  const start = () => {
    const child = launch()
    child.once('exit', (code, signal) => {
      if (signal) {
        onSignal(signal)
        return
      }

      if (code !== 0 && unexpectedRestarts < maxUnexpectedRestarts) {
        unexpectedRestarts += 1
        onRestart({ attempt: unexpectedRestarts, code })
        schedule(start, restartDelayMs)
        return
      }

      onExit(code ?? 1)
    })
  }

  start()
}
