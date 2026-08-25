/** Gateway-trace vocabulary and its log-only session event. @module @deepseek-ai/dsh-gateway-trace/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { GatewayRequestId, GatewayTraceId } from '@deepseek-ai/dsh-llm'

/** Opaque OpenTelemetry span id retained for safe local branch selection. */
export type GatewaySpanId = Branded<'GatewaySpanId'>

/**
 * Brand one OpenTelemetry span id parsed at the gateway response boundary.
 * @param value - parsed opaque span id.
 * @returns the same string with its gateway-span identity.
 */
export function GatewaySpanId(value: string): GatewaySpanId {
  return value as GatewaySpanId
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Sanitized observations retrieved from Higress after a response supplied
     * a request id or W3C trace id. This event is log-only and writers append
     * it with `ignorable: true`.
     */
    'gateway/trace': { turn: number; step: number } & GatewayTraceObservation
  }
}

/** A allow-listed, presentation-safe gateway span. */
export interface GatewayTraceSpan {
  /** Gateway span category, such as `higress.ai.model` or `higress.mcp.call`. */
  name: string
  /** Opaque OTLP span id, retained only when the provider supplied one. */
  spanId?: GatewaySpanId
  /** Opaque immediate parent id within the authorized result. */
  parentSpanId?: GatewaySpanId
  /** Gateway request id carried by this span, when the gateway supplied one. */
  requestId?: GatewayRequestId
  /** Span start time in milliseconds since the Unix epoch. */
  startedAtMs?: number
  /** Duration computed from OTLP timestamps when both are present. */
  durationMs?: number
  /** Stable observability attributes safe to show outside the Console. */
  attributes: Record<string, string | number>
}

/** Interval-unioned and accumulated timing for the displayed span set. */
export interface GatewayTraceTiming {
  /** End-to-end elapsed time, formed from the union of overlapping intervals. */
  actualDurationMs?: number
  /** Sum of span durations; overlaps remain counted for work attribution. */
  accumulatedDurationMs?: number
  /** Longest individual span, suitable for agent and LLM wait-time display. */
  longestSpanDurationMs?: number
}

/** Sanitized keys accepted by Higress reverse-query providers. */
export interface GatewayTraceLookup {
  /** Exact gateway request id from the response header, when supplied. */
  requestId?: GatewayRequestId
  /** W3C trace id parsed from the response traceparent, when supplied. */
  traceId?: GatewayTraceId
}

/** Sanitized result of resolving one {@link GatewayTraceLookup}. */
export interface GatewayTraceObservation {
  /** Trace resolved from the response correlation keys. */
  traceId: GatewayTraceId
  /** Original response `x-request-id` used for exact lookup, when present. */
  requestId?: GatewayRequestId
  /** Whether spans came from Tempo or Higress's explicit audit reconstruction. */
  source: 'tempo' | 'reconstructed'
  /** Console's index record for the observed request. */
  observation: {
    eventType?: string
    routeId?: string
    modelId?: string
    mcpServiceId?: string
    statusCode?: number
    durationMs?: number
    observedAt?: string
  }
  /** Allow-listed spans only; never request bodies, prompts, or credentials. */
  spans: GatewayTraceSpan[]
  /** Display timing computed from the allow-listed span timestamps. */
  timing: GatewayTraceTiming
}
