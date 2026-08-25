import { describe, expect, it } from 'vitest'
import { normalizeGatewayTrace } from '../src/normalize.ts'

describe('normalizeGatewayTrace', () => {
  it('retains only safe branch-selection metadata and allow-listed attributes', () => {
    const observation = normalizeGatewayTrace(
      '0123456789abcdef0123456789abcdef',
      'tempo',
      {},
      {
        batches: [{
          scopeSpans: [{
            spans: [{
              name: 'higress.gateway.request',
              spanId: 'gateway-span',
              parentSpanId: 'local-client-span',
              startTimeUnixNano: '1720000000123456789',
              endTimeUnixNano: '1720000001123456789',
              attributes: [
                { key: 'higress.request_id', value: { stringValue: 'request-1' } },
                { key: 'http.response.status_code', value: { intValue: '200' } },
                { key: 'http.request.header.authorization', value: { stringValue: 'secret' } },
              ],
            }],
          }],
        }],
      },
    )

    expect(observation.spans).toEqual([{
      name: 'higress.gateway.request',
      spanId: 'gateway-span',
      parentSpanId: 'local-client-span',
      requestId: 'request-1',
      startedAtMs: 1_720_000_000_123,
      durationMs: 1_000,
      attributes: {
        'higress.request_id': 'request-1',
        'http.response.status_code': 200,
      },
    }])
  })
})
