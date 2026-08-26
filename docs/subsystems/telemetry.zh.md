# 本地 Trace 遥测

[English](telemetry.md) | 中文

`ctx.traceTelemetry` 是 Harness 自有语义 Span 的可选服务。它创建根或子 Span，使异步 Consumer 可读取当前 W3C 上下文，并为出站网关 header 提供已配置的部署标识。OTLP Provider 负责导出与卸载。

源码：[`packages/telemetry/telemetry/src/index.ts`](../../packages/telemetry/telemetry/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtracetelemetry--tracetelemetry-abstract-seam"></a>

### `ctx.traceTelemetry` — `TraceTelemetry` (abstract seam)

Optional local tracing provider. Consumers obtain this service with `ctx.get('traceTelemetry')`, because a normal Harness deployment may not load any telemetry backend.

```ts cordis-catalog
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
```

Source: [`packages/telemetry/telemetry/src/index.ts:57`](../../packages/telemetry/telemetry/src/index.ts)
<!-- END GENERATED cordis-surface -->
