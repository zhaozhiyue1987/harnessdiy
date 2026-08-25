# Gateway Trace

English | [中文](gateway-trace.zh.md)

`ctx.gatewayTrace` is the reverse-query service for sanitized Higress observations. It accepts a response correlation with a request id or W3C Trace id, returns only allow-listed gateway facts, and never owns credentials, request bodies, model messages, or UI rendering. A trusted Host provider owns authorization and background scheduling; the Client reads the resulting log-only event.

Source: [`packages/gateway/gateway-trace/src/index.ts`](../../packages/gateway/gateway-trace/src/index.ts)

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
