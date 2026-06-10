export function disposeRpcResult<T>(value: T): T {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return value
  }

  const dispose = (value as Partial<Disposable>)[Symbol.dispose]
  if (typeof dispose === 'function') {
    dispose.call(value)
  }

  return value
}
