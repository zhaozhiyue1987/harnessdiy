import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { GatewayRequestId, GatewayTraceId, createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ConsoleGatewayTraceService, { resolveGatewayTraceConsoleConfig } from '../src/index.ts'

class TestCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly values: Record<string, string> = {}) { super(ctx) }
  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values[ref]
    return Promise.resolve(value === undefined ? undefined : { value, source: 'test' })
  }
  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.values[ref] !== undefined, writable: false })
  }
  override set(): Promise<void> { return Promise.reject(new Error('read-only test credentials')) }
  override unset(): Promise<void> { return Promise.reject(new Error('read-only test credentials')) }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const traceId = 'a'.repeat(32)
function tempoTrace(): Response {
  return json({ batches: [{ scopeSpans: [{ spans: [{
    name: 'higress.ai.model', startTimeUnixNano: '1000000000', endTimeUnixNano: '3000000000',
    attributes: [
      { key: 'gen_ai.response.model', value: { stringValue: 'deepseek-v4-flash' } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: '13' } },
      { key: 'authorization', value: { stringValue: 'must-not-leak' } },
    ],
  }] }] }] })
}

async function setup(
  values: Record<string, string> = {},
  retry?: { maxRetries: number; initialDelayMs: number; maxDelayMs: number; maxConcurrentQueries: number },
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestCredentials, values)
  const fiber = await ctx.plugin(ConsoleGatewayTraceService, {
    consoleBaseUrl: 'https://console.test/', basicUsernameRef: 'HIGRESS_CONSOLE_USERNAME', basicPasswordRef: 'HIGRESS_CONSOLE_PASSWORD',
    ...retry === undefined ? {} : { retry },
  })
  return { ctx, fiber }
}

afterEach(() => vi.unstubAllGlobals())

describe('resolveGatewayTraceConsoleConfig', () => {
  it('requires an absolute Console URL and paired Basic credential references', () => {
    expect(() => resolveGatewayTraceConsoleConfig({ consoleBaseUrl: '/relative' })).toThrow(/absolute URL/)
    expect(() => resolveGatewayTraceConsoleConfig({ consoleBaseUrl: 'https://console.test', basicUsernameRef: 'USER' })).toThrow(/configured together/)
  })
})

describe('ConsoleGatewayTraceService', () => {
  it('uses Console Basic auth and reads OTLP batches through the v1.1 flow', async () => {
    const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit) => {
      if (String(input).includes('/by-request/')) return json({ traceId, requestId: 'request-1', modelId: 'route-model', durationMs: 512 })
      return tempoTrace()
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber } = await setup({ HIGRESS_CONSOLE_USERNAME: 'user', HIGRESS_CONSOLE_PASSWORD: 'password' })

    await expect(ctx.gatewayTrace.query({ requestId: GatewayRequestId('request-1') })).resolves.toMatchObject({
      traceId, requestId: 'request-1', source: 'tempo', observation: { modelId: 'route-model', durationMs: 512 },
      spans: [{ name: 'higress.ai.model', attributes: { 'gen_ai.response.model': 'deepseek-v4-flash', 'gen_ai.usage.input_tokens': 13 } }],
      timing: { actualDurationMs: 2000, accumulatedDurationMs: 2000, longestSpanDurationMs: 2000 },
    })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Basic dXNlcjpwYXNzd29yZA==' } })
    await fiber.dispose()
  })

  it('requests reconstructed data only after Console identifies Tempo absence', async () => {
    const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/by-request/')) return json({ traceId, requestId: 'request-2' })
      if (url.endsWith(`/traces/${traceId}`)) return json({ code: 'tempo_trace_not_found' }, 404)
      return json({ traceId, spans: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ctx } = await setup({ HIGRESS_CONSOLE_USERNAME: 'user', HIGRESS_CONSOLE_PASSWORD: 'password' })

    await expect(ctx.gatewayTrace.query({ requestId: GatewayRequestId('request-2') })).resolves.toMatchObject({ source: 'reconstructed' })
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'https://console.test/v1/observability/traces/by-request/request-2',
      `https://console.test/v1/observability/traces/${traceId}`,
      `https://console.test/v1/observability/traces/reconstructed/${traceId}`,
    ])
  })

  it('reflects response-correlated stages without holding Console credentials in the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string, _init?: RequestInit) =>
      String(input).includes('/by-request/') ? json({ traceId, requestId: 'request-3' }) : tempoTrace(),
    ))
    const { ctx } = await setup({ HIGRESS_CONSOLE_USERNAME: 'user', HIGRESS_CONSOLE_PASSWORD: 'password' })
    const session = ctx.sessions.create(SessionId('gateway-trace-reflection'))
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'test', model: 'test' } }),
      traceMeta: { traceId: GatewayTraceId(traceId), requestId: GatewayRequestId('request-3'), receivedAt: '2026-08-24T00:00:00.000Z' },
    }, { surfaceOp: 'append' })
    await vi.waitFor(() =>{  expect(session.events.find(event => event.type === 'gateway/trace')).toMatchObject({
      data: { turn: 1, step: 1, requestId: 'request-3' }, ignorable: true,
    }) })
  })

  it('reflects a trace-only response correlation without requiring an x-request-id', async () => {
    const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => tempoTrace())
    vi.stubGlobal('fetch', fetchMock)
    const { ctx } = await setup({ HIGRESS_CONSOLE_USERNAME: 'user', HIGRESS_CONSOLE_PASSWORD: 'password' })
    const session = ctx.sessions.create(SessionId('gateway-trace-console-trace-only'))
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'test', model: 'test' } }),
      traceMeta: { traceId: GatewayTraceId(traceId), receivedAt: '2026-08-24T00:00:00.000Z' },
    }, { surfaceOp: 'append' })

    await vi.waitFor(() =>{  expect(session.events.find(event => event.type === 'gateway/trace')).toMatchObject({
      data: { turn: 1, step: 1, traceId }, ignorable: true,
    }) })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://console.test/v1/observability/traces/${traceId}`)
  })

  it('retries a temporarily unavailable Console trace request', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => {
      attempts++
      return attempts === 1 ? json({ code: 'temporarily_unavailable' }, 503) : tempoTrace()
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ctx } = await setup(
      { HIGRESS_CONSOLE_USERNAME: 'user', HIGRESS_CONSOLE_PASSWORD: 'password' },
      { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 1, maxConcurrentQueries: 1 },
    )
    const session = ctx.sessions.create(SessionId('gateway-trace-console-retry'))
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'test', model: 'test' } }),
      traceMeta: { traceId: GatewayTraceId(traceId), receivedAt: '2026-08-24T00:00:00.000Z' },
    }, { surfaceOp: 'append' })

    await vi.waitFor(() =>{  expect(session.events.some(event => event.type === 'gateway/trace')).toBe(true) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
