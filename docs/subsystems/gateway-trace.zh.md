# Gateway Trace

[English](gateway-trace.md) | 中文

`ctx.gatewayTrace` 是脱敏 Higress 观测的反查服务。它接收包含 request id 或 W3C Trace id 的响应关联，只返回 allow-list 允许的网关事实，绝不拥有凭据、请求正文、模型消息或 UI 渲染。受信 Host Provider 负责鉴权与后台调度；Client 只读取生成的仅日志事件。

源码：[`packages/gateway/gateway-trace/src/index.ts`](../../packages/gateway/gateway-trace/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgatewaytrace--gatewaytraceservice-abstract-seam"></a>

### `ctx.gatewayTrace` — `GatewayTraceService` (abstract seam)

Abstract gateway-trace service. `query` is a pure reverse-query: it resolves credentials, performs the gateway HTTP call, and returns the per-stage detail. The provider package orchestrates the listen → `query` → append flow that reflects the detail into a `gateway/trace` session event anchored to the stage; `query` itself appends nothing and holds no session context, which is why `GatewayTraceObservation` excludes the session-side `turn`/`step`. The service degrades to returning `undefined` when the gateway is unreachable or no credential is configured — no data, no crash. Load one implementation per context as `ctx.gatewayTrace`.

```ts cordis-catalog
/**
 * Reverse-query the gateway from either independent response correlation key.
 * @param correlation - exact request id and/or W3C trace id from the response.
 * @returns sanitized observation, or `undefined` when no usable key or data exists.
 */
abstract query(correlation: GatewayTraceLookup): Promise<GatewayTraceObservation | undefined>
```

Source: [`packages/gateway/gateway-trace/src/index.ts:41`](../../packages/gateway/gateway-trace/src/index.ts)
<!-- END GENERATED cordis-surface -->
