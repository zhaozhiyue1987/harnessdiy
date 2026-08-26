/**
 * W3C Trace Context utilities for outbound gateway tracing.
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
import type { AgentRunId } from './brand.ts'

/** The active trace identity propagated through the call chain. */
export interface ActiveTraceContext {
  /** W3C `traceparent` header value for the current outbound request. */
  traceparent: string
  /** Business correlation ID for the agent run (written as `X-Agent-Run-Id`). */
  agentRunId?: AgentRunId
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
 * @param trace - trace identity available to downstream work.
 * @param fn - operation to run in that context.
 * @returns the operation's result.
 */
export function withTraceContext<R>(trace: ActiveTraceContext, fn: () => R): R {
  return activeTraceContext.run(trace, fn)
}

/**
 * Read the active trace context, if one has been set. Returns `undefined`
 * outside a `withTraceContext` scope.
 * @returns the active trace identity, if any.
 */
export function getTraceContext(): ActiveTraceContext | undefined {
  return activeTraceContext.getStore()
}

/**
 * Generate a W3C trace-id (32 lowercase hex digits, 16 random bytes).
 *
 * The Agent loop creates one trace id per driver execution and reuses it for
 * every fallback LLM and MCP request in that execution.
 * @returns a lowercase hexadecimal trace id.
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Generate a W3C span-id (16 lowercase hex digits, 8 random bytes).
 *
 * Each outbound request (LLM call, MCP tool call) receives a unique span-id
 * so individual calls are distinguishable within the shared trace.
 * @returns a lowercase hexadecimal span id.
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
 * @returns a W3C `traceparent` header value.
 */
export function buildTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`
}

/**
 * Generate a W3C Trace Context `traceparent` header value with a fresh
 * trace-id and span-id. Convenience wrapper for callers that do not need
 * cross-step trace continuity.
 * @returns a W3C `traceparent` header value.
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
 * @returns headers for the active context, or an empty record.
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
