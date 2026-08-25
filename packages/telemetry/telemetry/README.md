# @deepseek-ai/dsh-telemetry

English | [中文](README.zh.md)

`TraceTelemetry` (`ctx.traceTelemetry`) is the optional Service Definition for a local Trace tree. Consumers read it through `ctx.get('traceTelemetry')`, so a deployment without a telemetry provider preserves its existing request behavior. A provider supplies the deployment platform and application identity used for `agent.run` attributes and `X-Agent-*` gateway headers.

| Role | Package |
| --- | --- |
| Service Definition | `@deepseek-ai/dsh-telemetry` |
| OTLP Provider | `@deepseek-ai/dsh-telemetry-otel` |
| Consumer | Agent loop, MCP client, and session-title LLM |

The service creates local spans, propagates their W3C context through asynchronous work, and exposes the active context for one outbound request. It does not query Higress, store gateway responses, or render a Trace UI.

## Model Experience

None, as local Trace context does not alter a model request.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- No local spans exist until a deployment mounts a `TraceTelemetry` provider.
