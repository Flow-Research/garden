import type { ConnectorCallbackEventItem } from '@/lib/api'

export const connectionsChangedEventName = 'garden:connections-changed'
export const connectorCallbackEventName = 'garden:connector-callback'

export type ConnectorCallbackBrowserEvent = CustomEvent<{
  event: ConnectorCallbackEventItem
}>

export function notifyConnectionsChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(connectionsChangedEventName))
}

export function notifyConnectorCallback(event: ConnectorCallbackEventItem) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(connectorCallbackEventName, {
      detail: { event },
    }),
  )
  notifyConnectionsChanged()
}
