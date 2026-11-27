/**
 * RN supports headers in its third WebSocket constructor argument.
 * https://github.com/facebook/react-native/blob/v0.83.10/packages/react-native/Libraries/WebSocket/WebSocket.js
 */
export function createNativeChatSocket(
  origin: string,
  path: string,
  getCookie: () => string,
  NativeSocketInput = globalThis.WebSocket,
) {
  const NativeSocket = NativeSocketInput as typeof WebSocket & {
    new (
      url: string,
      protocols?: string | string[],
      options?: { headers: Record<string, string> },
    ): WebSocket
  }
  return class GardenChatSocket extends NativeSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const target = new URL(url.toString())
      const expected = new URL(origin)
      expected.protocol = expected.protocol === 'https:' ? 'wss:' : 'ws:'
      if (
        target.origin !== expected.origin ||
        target.pathname !== path ||
        target.username ||
        target.password ||
        target.hash ||
        [...target.searchParams.keys()].some((key) => key !== '_pk')
      )
        throw new Error(
          'Refused a chat connection outside the selected private facet',
        )
      const cookie = getCookie()
      if (!cookie) throw new Error('Chat requires current sign-in credentials')
      super(url.toString(), protocols, {
        headers: { Cookie: cookie, Origin: 'garden-mobile://' },
      })
    }

    override send(data: Parameters<WebSocket['send']>[0]) {
      if (this.readyState !== NativeSocket.OPEN)
        throw new Error('Chat is disconnected. Nothing was queued.')
      super.send(data)
    }
  }
}
