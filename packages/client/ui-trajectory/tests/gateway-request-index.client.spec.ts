import { describe, expect, it } from 'vitest'
import type { TrajectoryGatewayTrace } from '../src/client/trajectory-contract.ts'
import { gatewayRequestBranch, indexGatewayRequests } from '../src/client/gateway-request-index.ts'

function trace(
  requestId: string,
  turn: number,
  step: number,
): TrajectoryGatewayTrace {
  return {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    requestId,
    source: 'tempo',
    observation: { statusCode: 200 },
    timing: {},
    spans: [
      {
        name: 'gen_ai.chat',
        spanId: 'local-model-client',
        attributes: { 'gen_ai.request.model': 'deepseek-v4-flash' },
      },
      {
        name: 'mcp.tools.call',
        spanId: 'local-mcp-client',
        parentSpanId: 'local-chat',
        attributes: { 'mcp.service_id': 'mcp_12306', 'mcp.tool_name': 'get-tickets' },
      },
      {
        name: 'higress.gateway.request',
        spanId: 'model-request',
        parentSpanId: 'local-model-client',
        requestId: 'model-request-id',
        startedAtMs: 1_000,
        durationMs: 600,
        attributes: {
          'higress.request_id': 'model-request-id',
          'http.response.status_code': 200,
        },
      },
      {
        name: 'higress.ai.model',
        spanId: 'model-response',
        parentSpanId: 'model-request',
        durationMs: 600,
        attributes: { 'gen_ai.response.model': 'deepseek-v4-flash' },
      },
      {
        name: 'higress.gateway.request',
        spanId: 'mcp-request',
        parentSpanId: 'local-mcp-client',
        requestId: 'mcp-request-id',
        startedAtMs: 2_000,
        durationMs: 120,
        attributes: {
          'higress.request_id': 'mcp-request-id',
          'http.response.status_code': 202,
        },
      },
      {
        name: 'higress.mcp.call',
        spanId: 'mcp-response',
        parentSpanId: 'mcp-request',
        durationMs: 120,
        attributes: { 'mcp.service': 'xingyuweather' },
      },
    ],
    turn,
    step,
  } as unknown as TrajectoryGatewayTrace
}

describe('indexGatewayRequests', () => {
  it('deduplicates reverse-query trace snapshots into real gateway roots', () => {
    const index = indexGatewayRequests([
      trace('model-request-id', 1, 1),
      trace('mcp-request-id', 1, 2),
    ])

    expect(index.records).toMatchObject([
      {
        requestId: 'mcp-request-id',
        kind: 'mcp',
        objectLabel: 'xingyuweather',
        statusCode: 202,
        startedAtMs: 2_000,
      },
      {
        requestId: 'model-request-id',
        kind: 'model',
        objectLabel: 'deepseek-v4-flash',
        statusCode: 200,
        startedAtMs: 1_000,
      },
    ])
    expect(index.records[0]?.root.trace).toMatchObject({ requestId: 'mcp-request-id', turn: 1, step: 2 })
  })

  it('includes an authorized local tool parent above the selected gateway root', () => {
    const index = indexGatewayRequests([trace('model-request-id', 1, 1)])
    const model = index.records.find(record => record.kind === 'model')!

    expect(gatewayRequestBranch(index, model)).toMatchObject({
      span: { span: { name: 'gen_ai.chat', spanId: 'local-model-client' } },
      children: [{ span: { span: { name: 'higress.gateway.request', spanId: 'model-request' } } }],
    })
  })

  it('keeps each MCP request under its own local tool span', () => {
    const index = indexGatewayRequests([trace('mcp-request-id', 1, 1)])
    const mcp = index.records.find(record => record.kind === 'mcp')!
    expect(gatewayRequestBranch(index, mcp)).toMatchObject({
      span: { span: { name: 'mcp.tools.call', spanId: 'local-mcp-client' } },
      children: [{ span: { span: { name: 'higress.gateway.request', spanId: 'mcp-request' } } }],
    })
  })
})
