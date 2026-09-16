import type { Env, LaptopMessage, RpcRequest } from './types'
import { HttpError, json, readJson } from './util'

type PendingRpc = {
  stream: TransformStream<Uint8Array, Uint8Array>
  writer: WritableStreamDefaultWriter<Uint8Array>
  resolveStart: (response: Response) => void
  rejectStart: (error: Error) => void
  started: boolean
  accepted: boolean
  bytes: number
  timeout: ReturnType<typeof setTimeout>
}

const decoder = new TextDecoder()
const ACCEPT_TIMEOUT_MS = 45_000
const DAEMON_TIMEOUT_MS = 120_000
const RPC_LIFETIME_MS = 5 * 60_000
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024

export class DeviceRelay implements DurableObject {
  private laptop: WebSocket | null = null
  private daemonOnline = false
  private pending = new Map<string, PendingRpc>()

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.laptop = this.liveLaptop()
  }

  async fetch(request: Request) {
    if (request.headers.get('x-forge-authorized') !== this.env.WORKER_PROXY_SECRET) {
      return json({ error: 'Unauthorized relay request' }, 401)
    }

    const url = new URL(request.url)
    if (url.pathname.endsWith('/connect')) return this.connectLaptopSocket(request)
    if (url.pathname.endsWith('/status')) {
      return json({
        online: this.liveLaptop()?.readyState === WebSocket.OPEN,
        daemonOnline: this.daemonOnline,
      })
    }
    if (url.pathname.endsWith('/disconnect') && request.method === 'POST') {
      this.liveLaptop()?.close(1000, 'Device removed')
      this.laptop = null
      this.daemonOnline = false
      this.failAll(new Error('Device removed'))
      return json({ disconnected: true })
    }
    if (url.pathname.endsWith('/rpc') && request.method === 'POST') return this.rpc(request)
    return json({ error: 'Not found' }, 404)
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (socket !== this.liveLaptop() && socket !== this.laptop) return
    this.laptop = socket
    let payload: LaptopMessage
    try {
      payload = JSON.parse(typeof message === 'string' ? message : decoder.decode(message)) as LaptopMessage
    } catch {
      socket.close(1003, 'Invalid JSON')
      return
    }

    if (payload.type === 'heartbeat') {
      this.daemonOnline = payload.daemonOnline
      socket.send(JSON.stringify({ type: 'heartbeat_ack', at: Date.now() }))
      return
    }
    if (!('id' in payload)) return
    const pending = this.pending.get(payload.id)
    if (!pending) return

    if (payload.type === 'rpc_accepted') {
      if (pending.started || pending.accepted) return
      pending.accepted = true
      clearTimeout(pending.timeout)
      pending.timeout = setTimeout(
        () => this.fail(payload.id, new Error('Local daemon did not respond')),
        DAEMON_TIMEOUT_MS,
      )
      return
    }
    if (payload.type === 'rpc_start') {
      if (pending.started) return
      pending.started = true
      pending.accepted = true
      clearTimeout(pending.timeout)
      pending.timeout = setTimeout(() => this.fail(payload.id, new Error('RPC lifetime exceeded')), RPC_LIFETIME_MS)
      const headers = new Headers(payload.headers)
      headers.delete('content-length')
      headers.delete('content-encoding')
      headers.set('cache-control', 'no-store')
      headers.set('x-content-type-options', 'nosniff')
      pending.resolveStart(new Response(pending.stream.readable, { status: payload.status, headers }))
      return
    }
    if (payload.type === 'rpc_chunk') {
      const chunk = decodeBase64(payload.bodyBase64)
      pending.bytes += chunk.byteLength
      if (pending.bytes > MAX_RESPONSE_BYTES) {
        this.fail(payload.id, new Error('RPC response is too large'))
        return
      }
      void pending.writer.write(chunk)
      return
    }
    if (payload.type === 'rpc_end') {
      clearTimeout(pending.timeout)
      void pending.writer.close()
      this.pending.delete(payload.id)
      return
    }
    if (payload.type === 'rpc_error') this.fail(payload.id, new Error(payload.message))
  }

  webSocketClose(socket: WebSocket) {
    if (socket === this.laptop) this.laptop = null
    this.daemonOnline = false
    this.failAll(new Error('Laptop disconnected'))
  }

  webSocketError(socket: WebSocket) {
    if (socket === this.laptop) this.laptop = null
    this.daemonOnline = false
    this.failAll(new Error('Laptop connection failed'))
  }

  private connectLaptopSocket(request: Request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket upgrade required' }, 426)
    }
    this.liveLaptop()?.close(1012, 'Replaced by a new connection')
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.state.acceptWebSocket(server, ['laptop'])
    this.laptop = server
    this.daemonOnline = false
    return new Response(null, { status: 101, webSocket: client })
  }

  private async rpc(request: Request) {
    const laptop = this.liveLaptop()
    if (!laptop || laptop.readyState !== WebSocket.OPEN) {
      return json({ error: 'Laptop is offline', code: 'LAPTOP_OFFLINE' }, 503)
    }
    if (this.pending.size >= 16) return json({ error: 'Laptop is busy', code: 'LAPTOP_BUSY' }, 429)

    let rpc: RpcRequest
    try {
      rpc = await readJson<RpcRequest>(request)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      throw error
    }

    const id = crypto.randomUUID()
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    let resolveStart!: (response: Response) => void
    let rejectStart!: (error: Error) => void
    const response = new Promise<Response>((resolve, reject) => {
      resolveStart = resolve
      rejectStart = reject
    })
    const timeout = setTimeout(
      () => this.fail(id, new Error('Laptop bridge did not accept the request in time')),
      ACCEPT_TIMEOUT_MS,
    )
    this.pending.set(id, {
      stream,
      writer: stream.writable.getWriter(),
      resolveStart,
      rejectStart,
      started: false,
      accepted: false,
      bytes: 0,
      timeout,
    })
    try {
      laptop.send(JSON.stringify({ type: 'rpc_request', id, ...rpc }))
    } catch {
      this.fail(id, new Error('Laptop connection is stale'))
      return json({ error: 'Laptop connection is stale', code: 'LAPTOP_STALE' }, 503)
    }

    try {
      return await response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RPC failed'
      const daemonDown = /daemon/i.test(message)
      return json(
        {
          error: message,
          code: daemonDown ? 'DAEMON_TIMEOUT' : 'LAPTOP_TIMEOUT',
        },
        504,
      )
    }
  }

  private liveLaptop() {
    const sockets = this.state.getWebSockets('laptop')
    const open = sockets.filter((socket) => socket.readyState === WebSocket.OPEN)
    this.laptop = open.at(-1) ?? null
    return this.laptop
  }

  private fail(id: string, error: Error) {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timeout)
    if (pending.started) void pending.writer.abort(error)
    else pending.rejectStart(error)
    this.pending.delete(id)
  }

  private failAll(error: Error) {
    for (const id of this.pending.keys()) this.fail(id, error)
  }
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
