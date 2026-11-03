import { randomBytes } from 'node:crypto'
import { version } from '../../package.json'
import type { LinkTool } from './protocol'

const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26']

export interface ToolCallOutcome {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError: boolean
}

export interface LinkToolServer {
  /** The MCP endpoint, on loopback only. */
  url: string
  /** Sent by the engine as a bearer token; any other request is refused. */
  token: string
  stop(): void
}

type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

function reply(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function failure(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

/**
 * A minimal MCP server (Streamable HTTP, JSON responses) on 127.0.0.1 for one turn. It offers
 * exactly the tools Teler sent for the turn and forwards each call to Teler; it runs nothing on
 * this computer itself.
 */
export function startToolServer(
  tools: readonly LinkTool[],
  call: (name: string, args: unknown) => Promise<ToolCallOutcome>
): LinkToolServer {
  const token = randomBytes(32).toString('base64url')
  const offered = new Map(tools.map((tool) => [tool.name, tool]))
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    // A Teler tool can take minutes; the engine's own timeout governs the call.
    idleTimeout: 0,
    async fetch(request) {
      if (request.headers.get('authorization') !== `Bearer ${token}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      if (new URL(request.url).pathname !== '/mcp')
        return new Response('Not found', { status: 404 })
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
      let message: JsonRpcRequest
      try {
        message = (await request.json()) as JsonRpcRequest
      } catch {
        return failure(null, -32700, 'Parse error')
      }
      const { id, method } = message
      const params =
        message.params && typeof message.params === 'object'
          ? (message.params as Record<string, unknown>)
          : {}
      if (id === undefined || id === null) return new Response(null, { status: 202 })
      switch (method) {
        case 'initialize': {
          const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
          return reply(id, {
            protocolVersion: SUPPORTED_PROTOCOLS.includes(requested)
              ? requested
              : SUPPORTED_PROTOCOLS[1],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'teler', version },
          })
        }
        case 'ping':
          return reply(id, {})
        case 'tools/list':
          return reply(id, {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: objectSchema(tool.inputSchema),
            })),
          })
        case 'tools/call': {
          const name = typeof params.name === 'string' ? params.name : ''
          if (!offered.has(name)) return failure(id, -32602, 'Unknown tool')
          const outcome = await call(name, params.arguments ?? {})
          return reply(id, outcome)
        }
        default:
          return failure(id, -32601, 'Method not found')
      }
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    token,
    stop: () => void server.stop(true),
  }
}

/** MCP requires an object schema at the top; anything else is wrapped as an open object. */
function objectSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const value = schema as Record<string, unknown>
    if (value.type === 'object') return value
  }
  return { type: 'object', properties: {} }
}
