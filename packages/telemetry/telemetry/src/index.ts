/**
 * TraceTelemetry Service Definition (`ctx.traceTelemetry`): optional providers
 * create local spans and expose the active W3C context to Harness consumers.
 * @module @deepseek-ai/dsh-telemetry
 */

import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    traceTelemetry: TraceTelemetry
  }
}

/** Scalar value accepted as an OpenTelemetry span attribute. */
export type TraceAttributeValue = string | number | boolean

/** Local trace identity available while a telemetry span is active. */
export interface ActiveTraceSpan {
  /** W3C trace id shared by all spans in the local operation tree. */
  traceId: string
  /** W3C span id of the active local span. */
  spanId: string
  /** Serialized W3C context injected into a downstream HTTP request. */
  traceparent: string
}

/** Deployment identity written both to Agent spans and gateway business headers. */
export interface TraceAgentIdentity {
  /** Platform identifier written as `agent.platform` and `X-Agent-Platform`. */
  agentPlatform: string
  /** Application identifier written as `agent.application_id` and `X-Agent-Application-Id`. */
  agentApplicationId: string
}

/** Local span identity plus Harness's required gateway business headers. */
export interface OutboundTraceContext<TAgentRunId extends string = string> extends ActiveTraceSpan, TraceAgentIdentity {
  /** Business correlation id written as `X-Agent-Run-Id`. */
  agentRunId: TAgentRunId
}

/** One local span to create around a Harness operation. */
export interface TraceSpanOptions {
  /** Stable semantic operation name, such as `agent.run` or `mcp.client`. */
  name: string
  /** Deployment-safe span attributes. */
  attributes?: Readonly<Record<string, TraceAttributeValue>>
  /** Start a new trace instead of inheriting the currently active local span. */
  root?: boolean
}

/**
 * Optional local tracing provider. Consumers obtain this service with
 * `ctx.get('traceTelemetry')`, because a normal Harness deployment may not
 * load any telemetry backend.
 */
export abstract class TraceTelemetry extends Service {
  constructor(ctx: Context) {
    super(ctx, 'traceTelemetry')
  }

  /**
   * Read the active local span, if the caller runs inside one.
   * @returns current W3C span identity, or `undefined` outside telemetry work.
   */
  abstract active(): ActiveTraceSpan | undefined

  /**
   * Read the deployment identity used for local Agent spans and gateway headers.
   * @returns configured platform and application identifiers.
   */
  abstract identity(): TraceAgentIdentity

  /**
   * Build gateway headers from the active local span and the configured
   * Harness identity.
   * @param agentRunId - stable id of the agent or auxiliary operation.
   * @returns context for one outbound request, or `undefined` outside a span.
   */
  abstract outbound<TAgentRunId extends string>(agentRunId: TAgentRunId): OutboundTraceContext<TAgentRunId> | undefined

  /**
   * Run work under a newly created local span. Rejections are recorded by the
   * provider before they reach the caller.
   * @param options - semantic name, attributes, and root policy for the span.
   * @param operation - work that inherits the new span through async calls.
   * @returns the operation result.
   */
  abstract withinSpan<T>(options: TraceSpanOptions, operation: () => Promise<T>): Promise<T>
}

export default TraceTelemetry
