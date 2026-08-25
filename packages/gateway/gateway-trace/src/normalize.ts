/** Sanitizes Higress Trace Query and Console response JSON for durable display. @module @deepseek-ai/dsh-gateway-trace/normalize */

import { GatewayRequestId, GatewayTraceId } from '@deepseek-ai/dsh-llm'
import { GatewaySpanId } from './types.ts'
import type { GatewayTraceObservation, GatewayTraceSpan, GatewayTraceTiming } from './types.ts'

const SAFE_ATTRIBUTE_KEYS = new Set([
  'higress.request_id', 'higress.route_id', 'higress.upstream_cluster', 'higress.trace_origin',
  'http.request.method', 'http.response.status_code', 'higress.outcome',
  'gen_ai.request.model', 'gen_ai.response.model', 'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens', 'gen_ai.usage.reasoning_tokens', 'gen_ai.usage.cached_tokens',
  'gen_ai.first_token_duration_ms', 'mcp.service', 'mcp.protocol', 'mcp.method', 'mcp.tool.name',
  'mcp.service_id', 'mcp.tool_name', 'tool_call_id', 'policy.decision',
  'service.name', 'dsh.agent.platform', 'dsh.application.id',
])

/** Build a sanitized observation from an index record and Trace response.
 * @param traceId - trace resolved from response correlation.
 * @param source - Trace storage that supplied the spans.
 * @param index - exact request index response, when queried.
 * @param body - untrusted Trace response JSON.
 * @returns a display-safe observation.
 */
export function normalizeGatewayTrace(
  traceId: string,
  source: GatewayTraceObservation['source'],
  index: unknown,
  body: unknown,
): GatewayTraceObservation {
  return {
    traceId: GatewayTraceId(traceId),
    source,
    observation: indexFields(object(index)),
    spans: extractSpans(body),
    timing: timingOf(body),
  }
}

/** Read an object only at an untrusted HTTP JSON boundary.
 * @param value - untrusted JSON value.
 * @returns an object record, if the value is an object.
 */
export function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return object(value)
}

/** Read the backend's stable error code from an untrusted HTTP JSON body.
 * @param response - failed HTTP response.
 * @returns the response error code, if present.
 */
export async function responseErrorCode(response: Response): Promise<string | undefined> {
  try { return nonEmptyString(object(await response.json())?.code) } catch { return undefined }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function nonEmptyString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
function finiteNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }

function indexFields(value: Record<string, unknown> | undefined): GatewayTraceObservation['observation'] {
  if (value === undefined) return {}
  const fields: GatewayTraceObservation['observation'] = {}
  for (const key of ['eventType', 'routeId', 'modelId', 'mcpServiceId', 'observedAt'] as const) {
    const item = nonEmptyString(value[key])
    if (item !== undefined) fields[key] = item
  }
  for (const key of ['statusCode', 'durationMs'] as const) {
    const item = finiteNumber(value[key])
    if (item !== undefined) fields[key] = item
  }
  return fields
}

function rawSpans(value: unknown): Record<string, unknown>[] {
  const direct = object(value)?.spans
  if (Array.isArray(direct)) return direct.flatMap((item): Record<string, unknown>[] => {
    const span = object(item)
    return span === undefined ? [] : [span]
  })
  const batches = object(value)?.batches
  const resourceSpans = object(value)?.resourceSpans
  const groups = Array.isArray(batches) ? batches : Array.isArray(resourceSpans) ? resourceSpans : []
  return groups.flatMap((batch) => {
    const scopeSpans = object(batch)?.scopeSpans
    return Array.isArray(scopeSpans) ? scopeSpans.flatMap((scope) => {
      const spans = object(scope)?.spans
      return Array.isArray(spans) ? spans.flatMap((span): Record<string, unknown>[] => {
        const parsed = object(span)
        return parsed === undefined ? [] : [parsed]
      }) : []
    }) : []
  })
}

function attributeValue(value: unknown): string | number | undefined {
  const entry = object(value)
  for (const key of ['stringValue', 'intValue', 'doubleValue'] as const) {
    const item = entry?.[key]
    if (typeof item === 'string' && item.length > 0) return key === 'intValue' && /^-?\d+$/.test(item) ? Number(item) : item
    if (typeof item === 'number' && Number.isFinite(item)) return item
  }
  return undefined
}

function extractSpans(body: unknown): GatewayTraceSpan[] {
  return rawSpans(body).flatMap((span) => {
    const name = nonEmptyString(span.name)
    if (name === undefined) return []
    const attributes: Record<string, string | number> = {}
    if (Array.isArray(span.attributes)) for (const item of span.attributes) {
      const entry = object(item)
      const key = nonEmptyString(entry?.key)
      if (key === undefined || !SAFE_ATTRIBUTE_KEYS.has(key)) continue
      const parsed = attributeValue(entry?.value)
      if (parsed !== undefined) attributes[key] = parsed
    }
    const durationMs = spanDurationMs(span)
    const spanId = nonEmptyString(span.spanId)
    const parentSpanId = nonEmptyString(span.parentSpanId)
    const requestId = typeof attributes['higress.request_id'] === 'string'
      ? GatewayRequestId(attributes['higress.request_id'])
      : undefined
    const startedAtMs = spanStartTimeMs(span)
    return [{
      name,
      attributes,
      ...spanId === undefined ? {} : { spanId: GatewaySpanId(spanId) },
      ...parentSpanId === undefined ? {} : { parentSpanId: GatewaySpanId(parentSpanId) },
      ...requestId === undefined ? {} : { requestId },
      ...startedAtMs === undefined ? {} : { startedAtMs },
      ...durationMs === undefined ? {} : { durationMs },
    }]
  })
}

/** Convert a valid OTLP nanosecond timestamp to a safe JavaScript epoch time. */
function spanStartTimeMs(span: Record<string, unknown>): number | undefined {
  const startedAt = nonEmptyString(span.startTimeUnixNano)
  if (startedAt === undefined || !/^\d+$/.test(startedAt)) return undefined
  const milliseconds = Number(BigInt(startedAt) / 1_000_000n)
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined
}

function spanDurationMs(span: Record<string, unknown>): number | undefined {
  const start = nonEmptyString(span.startTimeUnixNano)
  const end = nonEmptyString(span.endTimeUnixNano)
  if (start === undefined || end === undefined || !/^\d+$/.test(start) || !/^\d+$/.test(end)) return undefined
  const elapsed = BigInt(end) - BigInt(start)
  return elapsed < 0n ? undefined : Number(elapsed) / 1_000_000
}

function timingOf(body: unknown): GatewayTraceTiming {
  const intervals = rawSpans(body).flatMap((span) => {
    const start = nonEmptyString(span.startTimeUnixNano)
    const end = nonEmptyString(span.endTimeUnixNano)
    if (start === undefined || end === undefined || !/^\d+$/.test(start) || !/^\d+$/.test(end)) return []
    const from = BigInt(start)
    const to = BigInt(end)
    return to < from ? [] : [[from, to] as const]
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  if (intervals.length === 0) return {}
  let accumulated = 0n
  let longest = 0n
  let actual = 0n
  const firstInterval = intervals.at(0)
  if (firstInterval === undefined) return {}
  let [start, end] = firstInterval
  for (const [from, to] of intervals) {
    const duration = to - from
    accumulated += duration
    if (duration > longest) longest = duration
    if (from > end) { actual += end - start; start = from; end = to } else if (to > end) end = to
  }
  actual += end - start
  return {
    actualDurationMs: Number(actual) / 1_000_000,
    accumulatedDurationMs: Number(accumulated) / 1_000_000,
    longestSpanDurationMs: Number(longest) / 1_000_000,
  }
}
