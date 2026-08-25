import { describe, expect, it } from 'vitest'
import {
  AgentRunId,
  buildTraceparent,
  captureGatewayResponseCorrelation,
  collectGatewayResponseCorrelations,
  generateSpanId,
  generateTraceId,
  generateTraceparent,
  getTraceContext,
  traceContextHeaders,
  withTraceContext,
} from '@deepseek-ai/dsh-llm'

describe('generateTraceparent', () => {
  it('produces a valid W3C traceparent header value', () => {
    const value = generateTraceparent()
    // Format: 00-<32-hex-trace-id>-<16-hex-span-id>-01
    expect(value).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('generates unique trace ids across calls', () => {
    const a = generateTraceparent()
    const b = generateTraceparent()
    // Trace ids (positions 3-34) must differ
    expect(a.slice(3, 35)).not.toBe(b.slice(3, 35))
  })

  it('generates unique span ids across calls', () => {
    const a = generateTraceparent()
    const b = generateTraceparent()
    // Span Ids (positions 36-51) must differ
    expect(a.slice(36, 52)).not.toBe(b.slice(36, 52))
  })
})

describe('generateTraceId / generateSpanId / buildTraceparent', () => {
  it('generateTraceId produces 32 lowercase hex digits', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generateSpanId produces 16 lowercase hex digits', () => {
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('buildTraceparent assembles components correctly', () => {
    const traceId = '0'.repeat(32)
    const spanId = '1'.repeat(16)
    expect(buildTraceparent(traceId, spanId)).toBe(`00-${traceId}-${spanId}-01`)
  })

  it('reusing a trace-id with different span-ids produces different traceparents', () => {
    const traceId = generateTraceId()
    const a = buildTraceparent(traceId, generateSpanId())
    const b = buildTraceparent(traceId, generateSpanId())
    // Same trace-id portion
    expect(a.slice(3, 35)).toBe(b.slice(3, 35))
    // Different span-id portion
    expect(a.slice(36, 52)).not.toBe(b.slice(36, 52))
  })
})

describe('activeTraceContext / withTraceContext / getTraceContext', () => {
  it('returns undefined outside a withTraceContext scope', () => {
    expect(getTraceContext()).toBeUndefined()
  })

  it('returns the active context inside a withTraceContext scope', () => {
    const ctx = { traceparent: generateTraceparent() }
    withTraceContext(ctx, () => {
      expect(getTraceContext()).toBe(ctx)
    })
  })

  it('restores the outer scope after an inner withTraceContext', () => {
    const outer = { traceparent: generateTraceparent() }
    const inner = { traceparent: generateTraceparent() }
    withTraceContext(outer, () => {
      expect(getTraceContext()).toBe(outer)
      withTraceContext(inner, () => {
        expect(getTraceContext()).toBe(inner)
      })
      expect(getTraceContext()).toBe(outer)
    })
  })
})

describe('traceContextHeaders', () => {
  it('returns empty record outside a withTraceContext scope', () => {
    const headers = traceContextHeaders()
    expect(Object.keys(headers)).toHaveLength(0)
  })

  it('returns traceparent header inside a withTraceContext scope', () => {
    const traceparent = generateTraceparent()
    withTraceContext({ traceparent }, () => {
      const headers = traceContextHeaders()
      expect(headers.traceparent).toBe(traceparent)
      expect(headers['x-agent-run-id']).toBeUndefined()
    })
  })

  it('includes X-Agent-* headers when provided', () => {
    withTraceContext({
      traceparent: generateTraceparent(),
      agentRunId: AgentRunId('run-123'),
      agentPlatform: 'harness',
      agentApplicationId: 'agent-456',
    }, () => {
      const headers = traceContextHeaders()
      expect(headers['x-agent-run-id']).toBe('run-123')
      expect(headers['x-agent-platform']).toBe('harness')
      expect(headers['x-agent-application-id']).toBe('agent-456')
    })
  })
})

describe('gateway response correlations', () => {
  it('returns no collector entries outside an active trace context', async () => {
    const { result, correlations } = await collectGatewayResponseCorrelations(async () => 'completed')
    expect(result).toBe('completed')
    expect(correlations).toEqual([])
  })

  it('records both response headers inside one collector', async () => {
    const headers = new Headers({
      traceparent: '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f60708-01',
      'x-request-id': 'req-abc-123',
    })
    const { correlations } = await withTraceContext({ traceparent: generateTraceparent() }, () =>
      collectGatewayResponseCorrelations(async () => { captureGatewayResponseCorrelation(headers) }),
    )
    expect(correlations).toHaveLength(1)
    expect(correlations[0]).toMatchObject({
      responseTraceparent: '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f60708-01', traceId: 'bb7424f8effb4411008f0b7d04f0b07f', requestId: 'req-abc-123',
    })
    expect(correlations[0]?.receivedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('keeps a request id when traceparent is absent', async () => {
    const headers = new Headers({ 'x-request-id': 'req-only' })
    const { correlations } = await withTraceContext({ traceparent: generateTraceparent() }, () =>
      collectGatewayResponseCorrelations(async () => { captureGatewayResponseCorrelation(headers) }),
    )
    expect(correlations[0]).toMatchObject({ requestId: 'req-only' })
    expect(correlations[0]?.traceId).toBeUndefined()
  })

  it('returns a parsed correlation without an active collector', () => {
    const correlation = captureGatewayResponseCorrelation(new Headers({
      traceparent: '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f60708-01',
      'x-request-id': 'req-direct',
    }))
    expect(correlation).toMatchObject({
      responseTraceparent: '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f60708-01',
      traceId: 'bb7424f8effb4411008f0b7d04f0b07f',
      requestId: 'req-direct',
    })
  })

  it('isolates parallel collectors', async () => {
    const trace = { traceparent: generateTraceparent() }
    const [left, right] = await withTraceContext(trace, () => Promise.all([
      collectGatewayResponseCorrelations(async () => { captureGatewayResponseCorrelation(new Headers({ 'x-request-id': 'left' })) }),
      collectGatewayResponseCorrelations(async () => { captureGatewayResponseCorrelation(new Headers({ 'x-request-id': 'right' })) }),
    ]))
    expect(left.correlations.map(item => item.requestId)).toEqual(['left'])
    expect(right.correlations.map(item => item.requestId)).toEqual(['right'])
  })
})
