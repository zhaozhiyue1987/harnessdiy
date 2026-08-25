# @deepseek-ai/dsh-higress-trace

English | [中文](README.zh.md)

This optional bundle inserts the invariant registry, the gateway-trace invariant, and disabled `@deepseek-ai/dsh-gateway-trace-query` and `@deepseek-ai/dsh-telemetry-otel` rows. A deployment configures Trace Query with `traceQueryBaseUrl` and `tokenRef`, and trace export with an OTLP endpoint plus a non-empty `agentApplicationId`; the bundle contains no endpoint, credential, or Console provider. Add it to a profile only after supplying those trusted-server settings.

## Model Experience

None, as this bundle only composes Host-side tracing and reverse-query plugins.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The bundle remains inert until a trusted-server profile enables and configures its Trace Query and trace-export rows.
