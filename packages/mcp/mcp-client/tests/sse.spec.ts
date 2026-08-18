/**
 * SSE (legacy HTTP+SSE) transport tests for dsh-mcp-client. Exercises the REAL
 * MCP protocol against an in-process SSEServerTransport server (SDK 1.29 keeps
 * SSEServerTransport as the deprecated server-side counterpart of
 * SSEClientTransport). Sets a header and asserts it reaches both the SSE
 * stream and the POST message endpoint; no API key or external server needed.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { z } from 'zod'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const testToolSignal = new AbortController().signal

// ---- Helpers (mirrors mcp-client.e2e.ts) ----

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function sleep(ms: number): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

let callSeq = 0
function nextCallId(): CallId {
  return CallId(`sse-${++callSeq}`)
}

// ---- SSE (legacy HTTP+SSE) transport ----

describe('sse — in-process MCP server', () => {
  let ctx: Context
  let httpServer: Server
  // SDK 1.29 keeps SSEServerTransport as the deprecated server-side counterpart; the fixture deliberately exercises it.
  // oxlint-disable-next-line typescript/no-deprecated
  let serverTransport: SSEServerTransport | undefined
  /** Authorization header values observed by the HTTP server, in arrival order. */
  const seenAuth: Array<string | undefined> = []

  /**
   * Single-connection legacy SSE endpoint: GET /sse establishes the stream
   * (and advertises the /message POST endpoint via the `endpoint` event);
   * POST /message delivers outgoing JSON-RPC messages. The fixture tool set
   * mirrors the streamable-http e2e suite.
   */
  async function handleSseRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/sse') {
      seenAuth.push(req.headers.authorization)
      const server = new McpServer(
        { name: 'sse-fixture', version: '1.0.0' },
        { capabilities: { tools: {} } },
      )
      server.registerTool('ping', {
        description: 'Replies pong.',
        inputSchema: {},
      }, async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }))
      server.registerTool('shout', {
        description: 'Upper-cases a message.',
        inputSchema: { message: z.string().describe('Message to upper-case') },
      }, async args => ({
        content: [{ type: 'text', text: args.message.toUpperCase() }],
      }))
      // oxlint-disable-next-line typescript/no-deprecated
      serverTransport = new SSEServerTransport('/message', res)
      await server.connect(serverTransport)
      return
    }
    if (req.method === 'POST' && url.pathname === '/message') {
      seenAuth.push(req.headers.authorization)
      if (serverTransport === undefined) {
        res.writeHead(500).end('no SSE stream established')
        return
      }
      await serverTransport.handlePostMessage(req, res)
      return
    }
    res.writeHead(404).end()
  }

  beforeAll(async () => {
    httpServer = createServer((req, res) => {
      handleSseRequest(req, res).catch((error: unknown) => {
        res.writeHead(500).end(String(error))
      })
    })
    const listening: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    const address = httpServer.address()
    if (address === null || typeof address === 'string') throw new Error(`expected a TCP AddressInfo, got ${String(address)}`)
    const sseUrl = `http://127.0.0.1:${address.port}/sse`

    ctx = await mountRegistry()
    const config: Config = {
      transport: 'sse',
      serverName: 'legacy',
      url: sseUrl,
      headers: { Authorization: 'Bearer e2e-test-token' },
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
    }
    await apply(ctx, config)
  }, 30_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(200)
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.close(() => { closed.resolve() })
    await closed.promise
  })

  it('discovers tools under the server namespace over SSE', () => {
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('mcp__legacy__ping')
    expect(names).toContain('mcp__legacy__shout')
  })

  it('executes ping() → "pong" over SSE', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__legacy__ping', arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'pong' })
  })

  it('executes shout({ message }) with args over SSE', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__legacy__shout', arguments: { message: 'quiet' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'QUIET' })
  })

  it('sends configured headers on the stream and the message POSTs', () => {
    expect(seenAuth.length).toBeGreaterThanOrEqual(2)
    for (const auth of seenAuth) expect(auth).toBe('Bearer e2e-test-token')
  })
})
