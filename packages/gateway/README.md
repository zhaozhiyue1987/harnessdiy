# gateway/ — Higress Trace capability family

English | [中文](README.zh.md)

The gateway family records sanitized Higress facts after an Agent request completes. `gateway-trace` defines `ctx.gatewayTrace` and the log-only observation event; a deployment selects exactly one reverse-query provider. The Client consumes persisted observations and never calls a Higress API or receives query credentials.

| Package | Role | ctx key |
| --- | --- | --- |
| [`gateway-trace/`](gateway-trace/README.md) | Sanitized Trace query service and observation types | `ctx.gatewayTrace` |
| [`gateway-trace-query/`](gateway-trace-query/README.md) | Gateway Trace Query service-account provider | `ctx.gatewayTrace` |
| [`gateway-trace-console/`](gateway-trace-console/README.md) | Higress Console HTTP Basic provider | `ctx.gatewayTrace` |

The provider contract, authorization limits, and response-correlation rules are owned by [gateway-trace](gateway-trace/README.md). Local semantic spans and OTLP export are owned by the separate [telemetry family](../telemetry/README.md).
