export const connectionsChangedEventName = 'garden:connections-changed'

export function notifyConnectionsChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(connectionsChangedEventName))
}
