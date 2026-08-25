# Agent Note: Higress gateway trace integration

Status: implemented

English | [中文](2026-08-18-higress-gateway-trace.zh.md)

## Problem

Harness requires durable correlation between an agent stage and authorized Higress model or MCP Trace facts without exposing Higress internal storage, prompts, tool arguments, or credentials. The live integration is defined by the [v1.2 Trace guide](../../../../../higress/docs/integration/trace-integration-and-reverse-query-guide-v1.2.md) and the [Harness adaptation guide](../../../../../higress/docs/integration/harness-higress-trace-adaptation-guide-v1.md).

## Decision

The `dsh-gateway-trace` capability seam has a Service Definition, the default `dsh-gateway-trace-query` service-account Provider, the optional `dsh-gateway-trace-console` Basic Provider, and the Trajectory Consumer. Both Providers expose one lookup API that accepts either independently captured `x-request-id` or W3C trace id.

Each Agent driver execution creates one opaque run id and an `agent.run` root Span. Nested `gen_ai.chat`, `llm.client`, `mcp.tools.call`, and `mcp.client` Spans share that root; every model and HTTP MCP request injects the current client Span's `traceparent` with the same `X-Agent-Run-Id`, platform, and application headers. Response correlations preserve the valid returned `traceparent`, its trace id, optional request id, and receive time for reverse query only. A gateway response never becomes a local parent context. Each MCP dispatch has its own async-local collector, so parallel tools and protocol requests do not overwrite another response's association.

The default Provider uses a credential-referenced Trace Query Bearer token and Gateway `/__higress/trace-query/v1`; the Console Provider uses credential-referenced HTTP Basic and Console `/v1/observability`. The providers never exchange credentials or fall back across these two authorization models. They resolve a request id through `by-request`, or use a trace id directly, fetch `traces/{traceId}`, and request reconstructed data only after `tempo_trace_not_found`.

Providers append only sanitized, ignorable `gateway/trace` events anchored by request id when supplied or by trace id otherwise. They retain allow-listed gateway, model, and MCP attributes, source quality (`tempo` or `reconstructed`), and interval-unioned timing. Trajectory renders the returned Span usage and MCP facts alongside Harness-local usage without aggregating them. Providers never retain request or response bodies, Prompt text, tools arguments, Authorization, cookies, credentials, internal ownership fields, or an aggregate cost attributed to one stage.

## Consequences

- `gateway/trace` is log-only and does not alter `SESSION_FORMAT_VERSION` or model history.
- The invariant requires a prior response correlation with matching supplied request and trace ids; a trace-only response can anchor an observation.
- Queries run asynchronously with bounded concurrency and finite backoff; missing credentials and unavailable data append no observation.
- A session can have multiple driver executions; each execution receives a distinct run id and root Trace rather than reusing the session id.
- Service-account results may omit parents, external Agent spans, or unauthorized sibling branches. Consumers do not treat those omissions as a failed trace.
- Console cost summaries remain a separate, explicit aggregate concern and are absent from stage observations.

## Alternatives considered

- **Direct Collector, Tempo, or ClickHouse access.** These are internal deployment surfaces and bypass the supported authorization model.
- **One module-global response slot.** Concurrent MCP protocol requests cannot be attributed correctly through a shared latest value.
- **Console Basic as the default.** It conveys Console management authority; a service-account allow-list is the least-privilege production integration.
- **Synchronous reverse queries in the Agent loop.** Trace storage is eventually consistent and must not add user-visible turn latency.

## Verification

- Unit coverage exercises independent response headers, trace-only stage reflection, local Agent/LLM/MCP Span nesting, per-execution run identity, parallel collectors, Basic and Bearer credentials, OTLP and reconstructed payloads, allow-list filtering, explicit Tempo fallback, and Token rendering.
- Provider and Trajectory type checks cover the Service Definition, durable event, and Consumer boundary.
