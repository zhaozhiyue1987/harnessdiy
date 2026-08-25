/**
 * Tests for McpManagerService: catalog CRUD over a memory-backed settings
 * provider, and session-scoped bind/unbind realized as mcp-client plugin
 * instances mounted on the agent's scoped context. The MCP SDK is mocked so
 * bind exercises the full plugin lifecycle without a live server.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import McpManagerService from '../src/index.ts'

// ---- Mock MCP SDK (file-isolated so the mock does not leak elsewhere) ----

const { mockConnect, mockClose, mockListTools, MockClient } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  const mockCallTool = vi.fn<(
    _params?: Record<string, unknown>, _compatibilitySchema?: unknown, _options?: unknown,
  ) => Promise<unknown>>()
  const mockSetNotificationHandler = vi.fn()
  const mockRequest = vi.fn(async (
    request: { method: string; params?: Record<string, unknown> },
    _schema: unknown,
    options?: unknown,
  ): Promise<unknown> => {
    if (request.method === 'tools/list') return await mockListTools(request.params)
    if (request.method === 'tools/call') return await mockCallTool(request.params, undefined, options)
    throw new Error(`unexpected MCP request: ${request.method}`)
  })
  class MockClient {
    connect = mockConnect
    close = mockClose
    listTools = mockListTools
    callTool = mockCallTool
    request = mockRequest
    setNotificationHandler = mockSetNotificationHandler
  }
  return { mockConnect, mockClose, mockListTools, MockClient }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }))

// ---- Test harness ----

/** In-memory settings provider, mirroring the settings package's BareProvider. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpManagerService)
  return ctx
}

/** Mount a real session and mint an agent scope; the returned agent IS the scope key. */
async function makeAgent(ctx: Context, rawId: string): Promise<Agent> {
  const session = ctx.sessions.create(SessionId(rawId))
  const agent = { id: session.id } as Agent
  await ctx.plugin(Object.assign(
    (inner: Context) => { (agent as { ctx: Context }).ctx = createScope(inner, agent).ctx },
    { inject: ['tools'] },
  ))
  return agent
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConnect.mockResolvedValue(undefined)
  mockClose.mockImplementation(function (this: { onclose?: () => void }) {
    this.onclose?.()
    return Promise.resolve()
  })
  mockListTools.mockResolvedValue({
    tools: [{ name: 'remote', description: 'A remote tool', inputSchema: { type: 'object' } }],
  })
})

function manager(ctx: Context): McpManagerService {
  return ctx.get('mcpManager') as McpManagerService
}

const stdioServer = { serverName: 'demo', transport: 'stdio', command: 'npx' } as const

// ---- Catalog CRUD ----

describe('catalog management', () => {
  it('starts with an empty catalog', async () => {
    const ctx = await mount()
    const result = manager(ctx).list()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.servers).toEqual([])
  })

  it('upsert appends a resolved (default-filled) spec', async () => {
    const ctx = await mount()
    const result = await manager(ctx).upsert({ server: { ...stdioServer } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      serverName: 'demo',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
    expect(result.value.reconnect).toMatchObject({ enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 })
    const listed = manager(ctx).list()
    if (listed.ok) expect(listed.value.servers).toHaveLength(1)
  })

  it('upsert with an existing serverName replaces that entry', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    await manager(ctx).upsert({ server: { ...stdioServer, command: 'node' } })
    const listed = manager(ctx).list()
    if (!listed.ok) return
    expect(listed.value.servers).toHaveLength(1)
    expect(listed.value.servers[0]).toMatchObject({ command: 'node' })
  })

  it('upsert resolves an SSE spec with defaults', async () => {
    const ctx = await mount()
    const result = await manager(ctx).upsert({
      server: { serverName: 'web', transport: 'sse', url: 'https://example.test/sse' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      serverName: 'web',
      transport: 'sse',
      url: 'https://example.test/sse',
      headers: {},
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('rejects an invalid serverName or a missing command', async () => {
    const ctx = await mount()
    const badName = await manager(ctx).upsert({ server: { ...stdioServer, serverName: 'bad name!' } })
    expect(badName).toEqual({ ok: false, code: 'invalid-spec', message: expect.any(String) as unknown })
    const noCommand = await manager(ctx).upsert({ server: { serverName: 'demo', transport: 'stdio' } })
    expect(noCommand).toEqual({ ok: false, code: 'invalid-spec', message: expect.any(String) as unknown })
  })

  it('rejects an SSE or streamable-http spec without a URL', async () => {
    const ctx = await mount()
    const noSseUrl = await manager(ctx).upsert({ server: { serverName: 'web', transport: 'sse' } })
    expect(noSseUrl).toEqual({ ok: false, code: 'invalid-spec', message: expect.any(String) as unknown })
    const noHttpUrl = await manager(ctx).upsert({ server: { serverName: 'web', transport: 'streamable-http' } })
    expect(noHttpUrl).toEqual({ ok: false, code: 'invalid-spec', message: expect.any(String) as unknown })
  })

  it('remove deletes an entry and answers unknown-server for absent names', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    expect(await manager(ctx).deleteServer({ serverName: 'nope' })).toEqual({
      ok: false, code: 'unknown-server', message: expect.any(String) as unknown,
    })
    const removed = await manager(ctx).deleteServer({ serverName: 'demo' })
    expect(removed).toEqual({ ok: true, value: { serverName: 'demo' } })
    const listed = manager(ctx).list()
    if (listed.ok) expect(listed.value.servers).toEqual([])
  })
})

// ---- Session-scoped binding ----

describe('session-scoped binding', () => {
  it('binds a server so its tools land in the agent layer only', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    const agent = await makeAgent(ctx, 'session-a')

    const bound = await manager(ctx).bind(agent, { serverName: 'demo' })
    expect(bound.ok).toBe(true)
    if (!bound.ok) return
    expect(bound.value.tools).toEqual([{
      rawName: 'remote',
      publicName: `mcp__${bound.value.instanceName}__remote`,
      description: 'A remote tool',
      inputSchema: { type: 'object' },
    }])

    // Visible at the agent layer, invisible to the global and other sessions.
    const toolName = bound.value.tools[0]!.publicName
    expect(ctx.tools.get(toolName, agent)).toBeDefined()
    expect(ctx.tools.get(toolName)).toBeUndefined()

    const other = await makeAgent(ctx, 'session-b')
    expect(ctx.tools.get(toolName, other)).toBeUndefined()
    const listed = manager(ctx).bound(other)
    expect(listed.ok && listed.value.servers).toEqual([])
  })

  it('rejects a duplicate bind and reports bound servers per session', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    const agent = await makeAgent(ctx, 'session-a')

    expect((await manager(ctx).bind(agent, { serverName: 'demo' })).ok).toBe(true)
    expect(await manager(ctx).bind(agent, { serverName: 'demo' })).toEqual({
      ok: false, code: 'already-bound', message: expect.any(String) as unknown,
    })

    const other = await makeAgent(ctx, 'session-b')
    expect((await manager(ctx).bind(other, { serverName: 'demo' })).ok).toBe(true)

    const a = manager(ctx).bound(agent)
    const b = manager(ctx).bound(other)
    if (!a.ok || !b.ok) throw new Error('bind unexpectedly failed')
    expect(a.value.servers).toHaveLength(1)
    expect(b.value.servers).toHaveLength(1)
    // Distinct instance names keep the two sessions' namespaces apart.
    expect(a.value.servers[0]?.instanceName).not.toBe(b.value.servers[0]?.instanceName)
  })

  it('unbind removes the tools from the agent layer while other sessions keep theirs', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    const agent = await makeAgent(ctx, 'session-a')
    const other = await makeAgent(ctx, 'session-b')
    const boundA = await manager(ctx).bind(agent, { serverName: 'demo' })
    const boundOther = await manager(ctx).bind(other, { serverName: 'demo' })
    const toolName = boundA.ok ? boundA.value.tools[0]!.publicName : ''

    const unbound = await manager(ctx).unbind(agent, { serverName: 'demo' })
    expect(unbound).toEqual({ ok: true, value: { serverName: 'demo' } })
    expect(ctx.tools.get(toolName, agent)).toBeUndefined()

    // A second unbind of the same session answers not-bound; the other keeps its tools.
    expect(await manager(ctx).unbind(agent, { serverName: 'demo' })).toEqual({
      ok: false, code: 'not-bound', message: expect.any(String) as unknown,
    })
    expect(ctx.tools.get(boundOther.ok ? boundOther.value.tools[0]!.publicName : '', other)).toBeDefined()
    if (boundA.ok) {
      const toolsOnOther = manager(ctx).bound(other)
      expect(toolsOnOther.ok && toolsOnOther.value.servers).toHaveLength(1)
    }
  })

  it('remove unbinds every session that had the server bound', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    const agent = await makeAgent(ctx, 'session-a')
    const bound = await manager(ctx).bind(agent, { serverName: 'demo' })
    const toolName = bound.ok ? bound.value.tools[0]!.publicName : ''

    expect(await manager(ctx).deleteServer({ serverName: 'demo' })).toEqual({ ok: true, value: { serverName: 'demo' } })
    expect(ctx.tools.get(toolName, agent)).toBeUndefined()
    const after = manager(ctx).bound(agent)
    expect(after.ok && after.value.servers).toEqual([])
  })

  it('binds a streamable-http server', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({
      server: {
        serverName: 'remote',
        transport: 'streamable-http',
        url: 'https://example.test/mcp',
      },
    })
    const agent = await makeAgent(ctx, 'session-a')
    const bound = await manager(ctx).bind(agent, { serverName: 'remote' })
    expect(bound.ok).toBe(true)
    if (bound.ok) expect(bound.value.tools).toHaveLength(1)
  })

  it('answers bind-failed when the connection never comes up behind failOnStartupError', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({
      server: { ...stdioServer, failOnStartupError: true, reconnect: { enabled: false } },
    })
    mockConnect.mockRejectedValue(new Error('connection refused'))
    const agent = await makeAgent(ctx, 'session-a')

    const bound = await manager(ctx).bind(agent, { serverName: 'demo' })
    expect(bound.ok).toBe(false)
    if (!bound.ok) expect(bound.code).toBe('bind-failed')
  })
})

// ---- Server tools query ----

describe('server tools query', () => {
  it('returns tool count for a configured server', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'read', description: 'Read a file', inputSchema: { type: 'object' } },
        { name: 'write', description: 'Write a file', inputSchema: { type: 'object' } },
        { name: 'list', description: 'List files', inputSchema: { type: 'object' } },
      ],
    })

    const result = await manager(ctx).serverTools({ serverName: 'demo' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.serverName).toBe('demo')
      expect(result.value.toolsCount).toBe(3)
    }
  })

  it('answers unknown-server for an unconfigured name', async () => {
    const ctx = await mount()
    const result = await manager(ctx).serverTools({ serverName: 'nonexistent' })
    expect(result).toEqual({ ok: false, code: 'unknown-server', message: expect.any(String) as unknown })
  })

  it('answers bind-failed when the connection fails', async () => {
    const ctx = await mount()
    await manager(ctx).upsert({ server: { ...stdioServer } })
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await manager(ctx).serverTools({ serverName: 'demo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bind-failed')
  })
})
