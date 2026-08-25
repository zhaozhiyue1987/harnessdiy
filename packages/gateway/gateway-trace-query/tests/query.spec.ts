import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { GatewayRequestId, GatewayTraceId, createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import GatewayTraceQueryService, { resolveGatewayTraceQueryConfig } from '../src/index.ts'

class TestCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly values: Record<string, string>) { super(ctx) }
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
const traceId = 'b'.repeat(32)

async function setup(retry?: { maxAttempts: number; initialDelayMs: number; maxDelayMs: number; maxConcurrentQueries: number }) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestCredentials, { HIGRESS_TRACE_QUERY_TOKEN: 'scoped-token' })
  await ctx.plugin(GatewayTraceQueryService, {
    traceQueryBaseUrl: 'https://gateway.test/__higress/trace-query/v1/',
    tokenRef: 'HIGRESS_TRACE_QUERY_TOKEN',
    ...retry === undefined ? {} : { retry },
  })
  return ctx
}

afterEach(() => vi.unstubAllGlobals())

describe('resolveGatewayTraceQueryConfig', () => {
  it('requires an absolute HTTP endpoint', () => {
    expect(() => resolveGatewayTraceQueryConfig({ traceQueryBaseUrl: '/trace-query' })).toThrow(/absolute URL/)
  })
})

describe('GatewayTraceQueryService', () => {
  it('uses its service-account token for exact lookup and keeps only allow-listed attributes', async () => {
    const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit) => String(input).includes('/by-request/')
      ? json({ traceId, modelId: 'route-model' })
      : json({ batches: [{ scopeSpans: [{ spans: [{ name: 'higress.ai.model', startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000', attributes: [
        { key: 'gen_ai.response.model', value: { stringValue: 'model' } }, { key: 'authorization', value: { stringValue: 'never' } },
      ] }] }] }] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await setup()

    await expect(ctx.gatewayTrace.query({ requestId: GatewayRequestId('request-1') })).resolves.toMatchObject({
      traceId, requestId: 'request-1', source: 'tempo', observation: { modelId: 'route-model' },
      spans: [{ name: 'higress.ai.model', attributes: { 'gen_ai.response.model': 'model' } }],
    })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer scoped-token' } })
  })

  it('queries Trace directly when only a response trace id was captured', async () => {
    const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => json({ traceId, spans: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await setup()

    await expect(ctx.gatewayTrace.query({ traceId: GatewayTraceId(traceId) })).resolves.toMatchObject({ traceId, source: 'tempo' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://gateway.test/__higress/trace-query/v1/traces/${traceId}`)
  })

  it('uses reconstructed data only after the documented Tempo-missing code', async () => {
    const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit) => String(input).endsWith(`/traces/${traceId}`)
      ? json({ code: 'tempo_trace_not_found' }, 404)
      : json({ traceId, reconstructed: true, spans: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await setup()

    await expect(ctx.gatewayTrace.query({ traceId: GatewayTraceId(traceId) })).resolves.toMatchObject({ source: 'reconstructed' })
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      `https://gateway.test/__higress/trace-query/v1/traces/${traceId}`,
      `https://gateway.test/__higress/trace-query/v1/traces/reconstructed/${traceId}`,
    ])
  })

  it('reflects a trace-only response correlation without first requiring a request id', async () => {
    const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => json({ traceId, spans: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('gateway-trace-query-trace-only'))
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'test', model: 'test' } }),
      traceMeta: { traceId: GatewayTraceId(traceId), receivedAt: '2026-08-24T00:00:00.000Z' },
    }, { surfaceOp: 'append' })

    await vi.waitFor(() =>{  expect(session.events.find(event => event.type === 'gateway/trace')).toMatchObject({
      data: { turn: 1, step: 1, traceId }, ignorable: true,
    }) })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://gateway.test/__higress/trace-query/v1/traces/${traceId}`)
  })

  it('retries an unavailable Trace Query response without delaying the agent turn', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => {
      attempts++
      return attempts === 1 ? json({ code: 'temporarily_unavailable' }, 503) : json({ traceId, spans: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await setup({ maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, maxConcurrentQueries: 1 })
    const session = ctx.sessions.create(SessionId('gateway-trace-query-retry'))
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'test', model: 'test' } }),
      traceMeta: { traceId: GatewayTraceId(traceId), receivedAt: '2026-08-24T00:00:00.000Z' },
    }, { surfaceOp: 'append' })

    await vi.waitFor(() =>{  expect(session.events.some(event => event.type === 'gateway/trace')).toBe(true) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
