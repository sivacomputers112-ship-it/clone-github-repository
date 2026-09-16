export class DeviceRpcError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = '') {
    super(message)
    this.name = 'DeviceRpcError'
    this.status = status
    this.code = code
  }
}

function friendlyError(status: number, message: string, code: string) {
  if (status === 503 && (code === 'LAPTOP_OFFLINE' || /offline/i.test(message))) {
    return 'Laptop is offline. Keep the Forge bridge running on that machine.'
  }
  if (status === 504 || code === 'LAPTOP_TIMEOUT' || code === 'DAEMON_TIMEOUT') {
    return message.includes('daemon')
      ? 'The laptop is online, but the local agent daemon did not answer. Re-run the install command so the daemon and bridge restart.'
      : 'The laptop bridge did not accept the request in time. Re-run the install command on the laptop, then send again.'
  }
  if (status === 429) return 'The laptop is busy. Wait a moment and send again.'
  return message || `Laptop request failed (${status})`
}

export async function deviceRpc<T>(
  deviceId: string,
  phoneSecret: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${phoneSecret}`)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(`/d/${encodeURIComponent(deviceId)}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  })
  const text = await response.text()
  let data: { error?: string; code?: string } & Record<string, unknown> = {}
  if (text) {
    try {
      data = JSON.parse(text) as typeof data
    } catch {
      data = { error: text.slice(0, 240) }
    }
  }
  if (!response.ok) {
    throw new DeviceRpcError(
      friendlyError(response.status, String(data.error || ''), String(data.code || '')),
      response.status,
      String(data.code || ''),
    )
  }
  return data as T
}
