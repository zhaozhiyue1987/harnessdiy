# Agent Note: Higress gateway trace integration

Status: implemented

English | [中文](2026-08-18-higress-gateway-trace.zh.md)

## Problem

DeepSeek Harness calls model and MCP endpoints through a Higress AI gateway that generates W3C trace context and per-request IDs. Downstream applications (including Harness itself) currently have no way to correlate their own session events with the gateway's observability data (token counts, TTFT, cost, model routing). After a request completes, the gateway exposes `traceparent` and `x-request-id` in the response headers and offers read-only observability APIs, but Harness discards these headers and never queries them back.

The [trace integration spec](../../../../downstream-trace-integration-and-query-guide-v1.0.0.md) specifies the exact wire contract: inject `traceparent` + `X-Agent-*` headers on the way out, read `traceparent` + `x-request-id` from response headers, and asynchronously call `/v1/observability/traces/{traceId}` and related endpoints with `trace.read` scope.

## Decision

A new `dsh-gateway-trace` capability seam bridges the gap in three layers:

1. **Outbound header injection** — The LLM adapter (`dsh-llm-deepseek`) gains a typed `RequestTrace` context that the agent loop populates from session identity before each model request. The adapter writes `traceparent` (W3C format, propagated from the harness trace if present or freshly generated) and optional `X-Agent-*` business correlation headers into the HTTP request. The MCP client transport (`dsh-mcp-client`) does the same for Streamable HTTP and SSE transports.

2. **Response header capture** — Each adapter/transport reads `traceparent` and `x-request-id` from the HTTP response and returns them alongside its normal result. The agent loop and MCP tool bridge carry these back as a `traceMeta` bag on the `assistant/message` and `tool/result` session events.

3. **Async observability query** — A new `dsh-gateway-trace` plugin offers a `GatewayTraceService` with a single `query(requestId: string): Promise<GatewayTraceDetail | undefined>` method. On a configurable schedule or on-demand from the UI, it calls the gateway's `/v1/observability/traces/by-request/{requestId}` endpoint using a resource-owner JWT (resource-ownership mode per the spec), then appends a `gateway/trace` session event carrying the token, TTFT, model, and cost data.

The session event payload:

```ts
// Declared via declaration merging on SessionEventMap in dsh-gateway-trace
'gateway/trace': {
  turn: number
  step: number
  traceId: string
  requestId: string
  modelId: string        // resolved model (gen_ai.response.model)
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cachedTokens?: number
  firstTokenMs?: number  // TTFT
  durationMs: number
  estimatedCost?: string // CNY, from cost/summary
  observedAt: string     // ISO-8601
}
```

Authentication uses **resource-ownership mode**: the gateway admin registers the harness deployment as a machine client with `trace.read` scope against the workspace that owns the AI routes. The `GatewayTraceService` reads its credential from the `dsh-credentials` service (env or `.credentials.yaml`), so no secret is inlined.

### Wire flow

```
Agent Loop
  ├─ LLM request ── headers: {traceparent, X-Agent-Run-Id, X-Agent-Platform} ──▶ Higress
  │                                                          ◀── response: {traceparent, x-request-id}
  ├─ session.append('assistant/message', {..., traceMeta: {traceId, requestId}})
  │
  └─ GatewayTraceService.query(requestId) ──▶ GET /v1/observability/traces/by-request/{id}
                                               GET /v1/observability/traces/{traceId}
                                           ◀── {spans: [{attributes: gen_ai.usage.*}]}
       session.append('gateway/trace', {turn, step, traceId, requestId, inputTokens, ...})
```

## Alternatives considered

- **Synchronous token/TTFT in the response body.** The gateway does not inject usage data into the model response body; it writes to ClickHouse/Tempo asynchronously. Waiting for the observability pipeline in-band would add latency and break streaming. The spec explicitly says the gateway does not return token/cost synchronously.

- **Polling loop in the adapter.** Having the LLM adapter poll after stream completion would couple the transport layer to the observability API and block the agent loop on a network call that may take seconds. The async service design keeps the adapter's single responsibility and lets the trace query happen on a timer or UI demand.

- **Embedding observability data in `tool/result.meta`.** MCP tool results already carry a `meta` field, but the gateway's trace data is about the *model* call behind the MCP server, not the tool result itself. Conflating the two would misattribute tokens and cost. A dedicated `gateway/trace` event keeps the ownership clear.

- **Writing a gateway Wasm plugin to inject response headers.** Out of scope for Harness; the gateway team owns that surface. This design works with the gateway as-is (the spec confirms `traceparent` and `x-request-id` are already in response headers).

## Consequences

- Session logs gain a first-class `gateway/trace` event with structured token, TTFT, and cost data, queryable by downstream consumers (UI, export, analytics).
- The agent loop and MCP transports carry two additional string headers per request (`traceparent`, `x-request-id`). The wire overhead is negligible.
- A new `dsh-gateway-trace` package introduces a `GatewayTraceService` and the session event type. The `dsh-llm-deepseek` adapter and `dsh-mcp-client` transport each gain a small `RequestTrace` parameter.
- Resource-ownership authentication requires a one-time admin step: register a gateway client with `trace.read` scope and store the credential in `$DSH_HOME/.credentials.yaml`. The service fails gracefully (logs a warning, returns `undefined`) when no credential is configured — no data, no crash.
- The `gateway/trace` event is model-visible (it enters the session log), so `SESSION_FORMAT_VERSION` will bump per the versioning mechanism.

## Scope

This note covers the first two layers (header injection and response capture) as the MVP. The async observability query (`GatewayTraceService`) is the follow-up; it is designed here so the event type and wire contract are stable, but its implementation is deferred to a second PR.

## Testing

- Unit tests for header injection: the LLM adapter receives a `RequestTrace` and writes the correct `traceparent` and `X-Agent-*` headers.
- Unit tests for response header capture: a mock response with `traceparent` and `x-request-id` headers produces the expected `traceMeta` on `assistant/message`.
- Unit tests for the `gateway/trace` event payload shape (schema validation).
- The async query service is tested with a mock gateway observability endpoint.
- No snapshot: the `gateway/trace` event is new and adds no model-visible presentation beyond the session log entry.
