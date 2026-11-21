export const calls: string[] = []
export async function getServerFnById(id: string) {
  if (id !== 'security-fixture') throw new Error('Unknown test server function')
  return Object.assign(
    async () => {
      calls.push(id)
      return { result: new Response('same-origin action executed') }
    },
    { method: 'POST' },
  )
}
