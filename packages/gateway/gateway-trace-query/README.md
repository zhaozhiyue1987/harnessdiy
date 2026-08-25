# @deepseek-ai/dsh-gateway-trace-query

English | [中文](README.zh.md)

`dsh-gateway-trace-query` is the default trusted-server provider for `ctx.gatewayTrace`. It calls Higress Gateway Trace Query at `/__higress/trace-query/v1` with a credential-referenced Bearer service-account token, so the returned trace is limited by the account's Higress route, consumer, and MCP-service allow-list.

Configure `traceQueryBaseUrl` and `tokenRef`; `reflect` defaults to `true`. `retry` controls bounded background attempts, delay, and concurrency. The provider accepts either `x-request-id` or a W3C trace id, calls `by-request` only when an id is available, and uses reconstructed data only after `tempo_trace_not_found`.

The provider records only allow-listed Span attributes in log-only `gateway/trace` events, including trace-only response correlations. It never persists the token, Prompt, tool arguments, response bodies, Authorization, or internal ownership attributes. Missing credentials and unavailable results append no event. Disposal aborts active HTTP work and clears queued reflection.

## Model Experience

None, as gateway observations are ignorable session records and never join derived messages.

#### KV Cache effect

None; the provider changes no prompt prefix.

## Known Limitations and Deferred Work

- The service account cannot query route, consumer, or MCP service data outside its Higress allow-list.
