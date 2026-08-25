import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import OpenTelemetryTraceTelemetry, { resolveTracesEndpoint } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('resolveTracesEndpoint', () => {
  it('appends the OTLP traces path to a collector base URL', () => {
    expect(resolveTracesEndpoint('http://gateway.test:4318')).toBe('http://gateway.test:4318/v1/traces')
  })

  it('keeps an explicit OTLP traces endpoint', () => {
    expect(resolveTracesEndpoint('https://gateway.test/otel/v1/traces')).toBe('https://gateway.test/otel/v1/traces')
  })

  it('rejects a non-HTTP collector URL', () => {
    expect(() => resolveTracesEndpoint('grpc://gateway.test:4317')).toThrow(/http\(s\)/)
  })
})

describe('OpenTelemetryTraceTelemetry', () => {
  it('propagates a local parent span and emits gateway headers from the current child', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(OpenTelemetryTraceTelemetry, {
      endpoint: 'http://127.0.0.1:9',
      agentApplicationId: 'harness-local',
      exporter: { timeoutMillis: 1 },
    })

    let root: ReturnType<typeof ctx.traceTelemetry.active>
    let client: ReturnType<typeof ctx.traceTelemetry.outbound>
    await ctx.traceTelemetry.withinSpan({ name: 'agent.run', root: true }, async () => {
      root = ctx.traceTelemetry.active()
      await ctx.traceTelemetry.withinSpan({ name: 'llm.client' }, async () => {
        client = ctx.traceTelemetry.outbound('session-1')
      })
    })

    expect(root).toBeDefined()
    expect(client).toMatchObject({
      traceId: root?.traceId,
      agentRunId: 'session-1',
      agentPlatform: 'harness',
      agentApplicationId: 'harness-local',
    })
    expect(client?.spanId).not.toBe(root?.spanId)
    expect(client?.traceparent).toBe(`00-${client?.traceId}-${client?.spanId}-01`)
    expect(ctx.traceTelemetry.identity()).toEqual({ agentPlatform: 'harness', agentApplicationId: 'harness-local' })
  })
})
