import { describe, expect, it } from 'vitest'
import { captureGatewayResponseCorrelation } from '@deepseek-ai/dsh-llm'

describe('gateway trace response headers', () => {
  it('uses the shared parser for both response correlation headers', () => {
    const correlation = captureGatewayResponseCorrelation(new Headers({
      traceparent: '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f67890-01',
      'x-request-id': 'req-abc-123',
    }))
    expect(correlation).toMatchObject({
      traceparent: '00-bb7424f8effb4411008f0b7d04f0b07f-a1b2c3d4e5f67890-01',
      traceId: 'bb7424f8effb4411008f0b7d04f0b07f',
      requestId: 'req-abc-123',
    })
  })

  it('keeps a request id when a response does not carry traceparent', () => {
    expect(captureGatewayResponseCorrelation(new Headers({ 'x-request-id': 'req-only' })))
      .toMatchObject({ requestId: 'req-only' })
  })

  it('rejects an invalid traceparent when it is the only response correlation header', () => {
    expect(captureGatewayResponseCorrelation(new Headers({ traceparent: 'invalid' }))).toBeUndefined()
  })
})
