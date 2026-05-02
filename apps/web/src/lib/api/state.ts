import { ApiTransport, type ApiTransportOptions } from './transport'

let transport: ApiTransport | null = null

export function configureApi(baseUrl: string, options?: ApiTransportOptions) {
  transport = new ApiTransport(baseUrl, options)
  return transport
}

export function getApiTransport() {
  if (!transport) {
    throw new Error('API transport not initialised - call configureApi() first')
  }
  return transport
}

export function getBaseUrl() {
  return getApiTransport().getBaseUrl()
}

export function setWorkspaceId(id: string | null) {
  getApiTransport().setWorkspaceId(id)
}
