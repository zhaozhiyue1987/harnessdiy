/**
 * W3C Trace Context utilities for gateway trace correlation.
 *
 * A single **trace-id** is shared across all steps of one agent turn so the
 * gateway links LLM calls and MCP tool calls into one trace. Each step (LLM
 * request or MCP call) gets its own **span-id**.
 *
 * The `activeTraceContext` store carries the current trace identity through
 * the call chain so MCP transports and other downstream callers can inject
 * `traceparent` and `X-Agent-*` headers without explicit parameter threading.
 *
 * @module @deepseek-ai/dsh-llm/trace-context
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import type { TraceMeta } from './types.ts'

/** The active trace identity propagated through the call chain. */
export interface ActiveTraceContext {
  /** W3C `traceparent` header value for the current outbound request. */
  traceparent: string
  /** Business correlation ID for the agent run (written as `X-Agent-Run-Id`). */
  agentRunId?: string
  /** Platform identifier (written as `X-Agent-Platform`). */
  agentPlatform?: string
  /** Application identifier (written as `X-Agent-Application-Id`). */
  agentApplicationId?: string
}

/**
 * Async-local store carrying the active trace context. MCP transports and
 * other downstream callers read from this store to inject gateway headers
 * without explicit parameter threading.
 */
export const activeTraceContext = new AsyncLocalStorage<ActiveTraceContext>()

/**
 * Run `fn` with the given trace context active, so downstream callers (MCP
 * transports, HTTP clients) can read it via {@link activeTraceContext}.
 */
export function withTraceContext<R>(trace: ActiveTraceContext, fn: () => R): R {
  return activeTraceContext.run(trace, fn)
}

/**
 * Read the active trace context, if one has been set. Returns `undefined`
 * outside a `withTraceContext` scope.
 */
export function getTraceContext(): ActiveTraceContext | undefined {
  return activeTraceContext.getStore()
}

/**
 * Generate a W3C trace-id (32 lowercase hex digits, 16 random bytes).
 *
 * One trace-id is created per agent turn and reused for every LLM and MCP
 * request within that turn so the gateway groups them into a single trace.
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Generate a W3C span-id (16 lowercase hex digits, 8 random bytes).
 *
 * Each outbound request (LLM call, MCP tool call) receives a unique span-id
 * so individual calls are distinguishable within the shared trace.
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Build a W3C Trace Context `traceparent` header value from components.
 *
 * Format: `00-<traceId>-<spanId>-01`
 *
 * @param traceId - 32-hex-digit trace-id (shared across one agent turn).
 * @param spanId  - 16-hex-digit span-id (unique per outbound request).
 */
export function buildTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`
}

/**
 * Generate a W3C Trace Context `traceparent` header value with a fresh
 * trace-id and span-id. Convenience wrapper for callers that do not need
 * cross-step trace continuity.
 */
export function generateTraceparent(): string {
  return buildTraceparent(generateTraceId(), generateSpanId())
}

/**
 * Build the HTTP headers to inject for the active trace context. Returns an
 * empty record when no trace context is active, so callers can spread the
 * result unconditionally.
 *
 * Produced headers: `traceparent`, `X-Agent-Run-Id`, `X-Agent-Platform`,
 * `X-Agent-Application-Id` (each omitted when the corresponding field is
 * absent).
 */
export function traceContextHeaders(): Record<string, string> {
  const ctx = getTraceContext()
  if (ctx === undefined) return {}
  const headers: Record<string, string> = { traceparent: ctx.traceparent }
  if (ctx.agentRunId !== undefined) headers['x-agent-run-id'] = ctx.agentRunId
  if (ctx.agentPlatform !== undefined) headers['x-agent-platform'] = ctx.agentPlatform
  if (ctx.agentApplicationId !== undefined) headers['x-agent-application-id'] = ctx.agentApplicationId
  return headers
}

// ---- Response-side trace correlation ----

/**
 * Store for the most recent gateway trace correlation metadata captured from
 * an HTTP response. MCP tool calls use this to pick up `traceparent` and
 * `x-request-id` from the gateway response when the MCP SDK does not expose
 * raw response headers.
 *
 * This is a module-level variable (not ALS) because the MCP SDK's `client.request()`
 * call is synchronous on the outside — the response arrives after the `await`
 * resolves, and reading from ALS at that point would still be within the same
 * async context where the trace context was set. A simple variable avoids
 * unnecessary ALS nesting.
 */
let lastResponseTraceMeta: TraceMeta | undefined

/**
 * Extract `traceparent` and `x-request-id` from an HTTP response and store
 * them as the last captured trace meta. Called by the trace-aware fetch
 * wrapper after each MCP HTTP response.
 */
export function captureResponseTraceMeta(headers: Headers): void {
  const traceparent = headers.get('traceparent')
  if (traceparent === null) return
  const parts = traceparent.split('-')
  const traceId = parts[1]
  if (traceId === undefined || traceId.length === 0) return
  const requestId = headers.get('x-request-id')
  lastResponseTraceMeta = { traceId, ...requestId !== null ? { requestId } : {} }
}

/**
 * Read and clear the last captured response trace meta. The MCP tool bridge
 * calls this after each `tools/call` to attach trace correlation to the
 * `tool/result` session event. Returns `undefined` when the last MCP response
 * did not carry gateway trace headers.
 */
export function consumeResponseTraceMeta(): TraceMeta | undefined {
  const meta = lastResponseTraceMeta
  lastResponseTraceMeta = undefined
  return meta
}
