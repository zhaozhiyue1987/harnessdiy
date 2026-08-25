# @deepseek-ai/dsh-gateway-trace

English | [中文](README.zh.md)

`GatewayTraceService` (`ctx.gatewayTrace`) is the Service Definition for sanitized Higress Trace reverse queries. It accepts a response correlation with either an `x-request-id` or W3C trace id and returns a `GatewayTraceObservation`; it does not own credentials, HTTP transport, session placement, or UI rendering.

| Role | Package |
| --- | --- |
| Service Definition | `@deepseek-ai/dsh-gateway-trace` |
| Default Provider | `@deepseek-ai/dsh-gateway-trace-query` — Gateway service-account Bearer token |
| Optional Provider | `@deepseek-ai/dsh-gateway-trace-console` — Console HTTP Basic |
| Consumer | `@deepseek-ai/dsh-client-ui-trajectory` |

Providers append a log-only, `ignorable` `gateway/trace` event after a successful background query. A request id anchors the observation when present; a response that supplies only a valid trace id is also a durable stage anchor. The invariant requires the supplied correlation keys to agree with the earlier `assistant/message` or `tool/result`.

The declared result holds only allow-listed gateway, model, and MCP attributes, `tempo` or `reconstructed` provenance, and timing formed from span intervals. It excludes messages, tool arguments, credentials, HTTP bodies, and aggregate cost. The event never enters model history and does not change `SESSION_FORMAT_VERSION`.

## Model Experience

None, as `gateway/trace` is log-only and never enters model history.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Gateway observations are authorized partial views; they do not reconstruct external Agent spans or an unrestricted distributed trace tree.
