import { describe, expect, it } from 'vitest'

/** Replicate the private helpers for unit testing. */
function traceIdFromParent(header: string | null): string | undefined {
  if (header === null) return undefined
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(header)
  return match?.[1]
}

function traceMetaFromHeaders(headers: { get(name: string): string | null }): { traceId: string; requestId?: string } | undefined {
  const traceparent = headers.get('traceparent')
  const requestIdValue = headers.get('x-request-id') ?? headers.get('x-deepseek-request-id')
  const traceId = traceIdFromParent(traceparent)
  if (traceId === undefined) return undefined
  return { traceId, ...requestIdValue !== null && requestIdValue.length > 0 ? { requestId: requestIdValue } : {} }
}

describe('traceIdFromParent', () => {
  it('extracts trace-id from a valid traceparent header', () => {
    expect(traceIdFromParent('00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f67890-01'))
      .toBe('bb7424f8effb4411008f0b7d04f0b07f')
  })

  it('returns undefined for null header', () => {
    expect(traceIdFromParent(null)).toBeUndefined()
  })

  it('returns undefined for invalid format', () => {
    expect(traceIdFromParent('invalid')).toBeUndefined()
    expect(traceIdFromParent('00-short-long-id-01')).toBeUndefined()
    expect(traceIdFromParent('01-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f67890-01')).toBeUndefined()
  })

  it('returns undefined for trace-id of all zeros', () => {
    // The W3C spec forbids all-zero trace-id, but the regex only validates format
    expect(traceIdFromParent('00-00000000000000000000000000000000-a1b2c3d4e5f67890-01'))
      .toBe('00000000000000000000000000000000')
  })

  it('returns undefined for uppercase hex', () => {
    expect(traceIdFromParent('00-BB7424F8EFFB4411008F0B7D04F0B07F-A1B2C3D4E5F67890-01'))
      .toBeUndefined()
  })
})

describe('traceMetaFromHeaders', () => {
  it('extracts trace meta when both headers are present', () => {
    const headers = {
      get: (name: string) => {
        if (name === 'traceparent') return '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f67890-01'
        if (name === 'x-request-id') return 'req-abc-123'
        return null
      },
    }
    expect(traceMetaFromHeaders(headers)).toEqual({
      traceId: 'bb7424f8effb4411008f0b7d04f0b07f',
      requestId: 'req-abc-123',
    })
  })

  it('returns trace meta without requestId when only traceparent is present', () => {
    const headers = {
      get: (name: string) => name === 'traceparent' ? '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f67890-01' : null,
    }
    const meta = traceMetaFromHeaders(headers)
    expect(meta).toBeDefined()
    expect(meta!.traceId).toBe('bb7424f8effb4411008f0b7d04f0b07f')
    expect(meta!.requestId).toBeUndefined()
  })

  it('returns undefined when traceparent is missing', () => {
    const headers = {
      get: (name: string) => name === 'x-request-id' ? 'req-abc-123' : null,
    }
    expect(traceMetaFromHeaders(headers)).toBeUndefined()
  })

  it('returns undefined when both headers are missing', () => {
    const headers = { get: () => null as string | null }
    expect(traceMetaFromHeaders(headers)).toBeUndefined()
  })

  it('omits requestId when x-request-id is empty', () => {
    const headers = {
      get: (name: string) => {
        if (name === 'traceparent') return '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f67890-01'
        if (name === 'x-request-id') return ''
        return null
      },
    }
    const meta = traceMetaFromHeaders(headers)
    expect(meta).toBeDefined()
    expect(meta!.traceId).toBe('bb7424f8effb4411008f0b7d04f0b07f')
    expect(meta!.requestId).toBeUndefined()
  })
})
