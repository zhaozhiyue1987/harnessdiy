/**
 * OTLP/HTTP protobuf implementation of the local TraceTelemetry seam.
 * @module @deepseek-ai/dsh-telemetry-otel
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ROOT_CONTEXT, SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, TracerProvider, type BatchSpanProcessorOptions } from '@opentelemetry/sdk-trace'
import {
  TraceTelemetry,
  type ActiveTraceSpan,
  type TraceAgentIdentity,
  type OutboundTraceContext,
  type TraceSpanOptions,
} from '@deepseek-ai/dsh-telemetry'

/** Default Harness identity for gateway business-correlation headers. */
export const DEFAULT_AGENT_PLATFORM = 'harness'

/** Default local service name reported to OTLP. */
export const DEFAULT_SERVICE_NAME = 'harness'

/** Default grace period for flushing spans during plugin disposal. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MILLIS = 3_000

/** OpenTelemetry trace exporter and Harness identity configuration. */
export interface Config {
  /** OTLP/HTTP collector base URL, normally `http://<gateway-host>:4318`. */
  endpoint: string
  /** Required deployment identity written as `X-Agent-Application-Id`. */
  agentApplicationId: string
  /** Platform identity written as `X-Agent-Platform`. */
  agentPlatform?: string
  /** OpenTelemetry resource `service.name`. */
  serviceName?: string
  /** Extra OTLP exporter options, excluding the resolved traces URL. */
  exporter?: Omit<OTLPExporterNodeConfigBase, 'url'>
  /** Extra batch processor options, excluding the exporter constructed here. */
  processor?: Omit<BatchSpanProcessorOptions, 'exporter'>
  /** Upper bound for disposal-time exporter flush. */
  shutdownTimeoutMillis?: number
}

/** Loader schema; detailed URL and SDK options validate during construction. */
export const Config: z<Config> = z.object({
  endpoint: z.string().required(),
  agentApplicationId: z.string().min(1).required(),
  agentPlatform: z.string().min(1).default(DEFAULT_AGENT_PLATFORM),
  serviceName: z.string().min(1).default(DEFAULT_SERVICE_NAME),
  exporter: z.any(),
  processor: z.any(),
  shutdownTimeoutMillis: z.number().min(1).default(DEFAULT_SHUTDOWN_TIMEOUT_MILLIS),
})

/**
 * Resolve the OTLP traces endpoint from the deployment's collector base URL.
 * @param endpoint - collector base URL or an explicit `/v1/traces` URL.
 * @returns absolute OTLP/HTTP protobuf Trace endpoint.
 */
export function resolveTracesEndpoint(endpoint: string): string {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error(`telemetry-otel: endpoint is not a valid URL: ${JSON.stringify(endpoint)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`telemetry-otel: endpoint must be http(s), got ${parsed.protocol}`)
  }
  if (!parsed.pathname.endsWith('/v1/traces')) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1/traces`
  }
  return parsed.toString()
}

/** Convert an active OTel span into the W3C fields Harness injects downstream. */
function activeSpan(span: Span | undefined): ActiveTraceSpan | undefined {
  if (span === undefined) return undefined
  const context = span.spanContext()
  if (!trace.isSpanContextValid(context)) return undefined
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    traceparent: `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, '0')}`,
  }
}

/** Render an Error-like rejection without assuming it is an Error instance. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Local OpenTelemetry provider. It owns a private async context manager rather
 * than replacing the process-global OTel provider, so other plugins can export
 * independently in the same host process.
 */
export class OpenTelemetryTraceTelemetry extends TraceTelemetry {
  static Config = Config

  private readonly contextManager = new AsyncLocalStorageContextManager().enable()
  private readonly provider: TracerProvider
  private readonly tracer
  private readonly agentPlatform: string
  private readonly agentApplicationId: string

  constructor(ctx: Context, config: Config) {
    super(ctx)
    const url = resolveTracesEndpoint(config.endpoint)
    this.agentPlatform = config.agentPlatform ?? DEFAULT_AGENT_PLATFORM
    this.agentApplicationId = config.agentApplicationId
    this.provider = new TracerProvider({
      resource: resourceFromAttributes({ 'service.name': config.serviceName ?? DEFAULT_SERVICE_NAME }),
      spanProcessors: [new BatchSpanProcessor({ ...config.processor, exporter: new OTLPTraceExporter({ ...config.exporter, url }) })],
    })
    this.tracer = this.provider.getTracer('@deepseek-ai/dsh-telemetry-otel')
    ctx.effect(() => async () => {
      this.contextManager.disable()
      await this.provider.shutdown()
    }, 'telemetry-otel.shutdown()')
  }

  override active(): ActiveTraceSpan | undefined {
    return activeSpan(trace.getSpan(this.contextManager.active()))
  }

  override identity(): TraceAgentIdentity {
    return { agentPlatform: this.agentPlatform, agentApplicationId: this.agentApplicationId }
  }

  override outbound<TAgentRunId extends string>(agentRunId: TAgentRunId): OutboundTraceContext<TAgentRunId> | undefined {
    const active = this.active()
    return active === undefined ? undefined : {
      ...active,
      agentRunId,
      agentPlatform: this.agentPlatform,
      agentApplicationId: this.agentApplicationId,
    }
  }

  override async withinSpan<T>(options: TraceSpanOptions, operation: () => Promise<T>): Promise<T> {
    const parent = options.root === true ? ROOT_CONTEXT : this.contextManager.active()
    const span = this.tracer.startSpan(options.name, {
      ...options.attributes === undefined ? {} : { attributes: options.attributes },
    }, parent)
    const active = trace.setSpan(parent, span)
    return this.contextManager.with(active, async () => {
      try {
        return await operation()
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(errorMessage(error)))
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) })
        throw error
      } finally {
        span.end()
      }
    })
  }
}

export default OpenTelemetryTraceTelemetry
