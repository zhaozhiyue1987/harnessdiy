# @deepseek-ai/dsh-telemetry-otel

English | [中文](README.zh.md)

This provider implements `TraceTelemetry` with OpenTelemetry's OTLP/HTTP protobuf exporter. It owns an independent asynchronous context manager, so mounting it does not replace another plugin's process-global OpenTelemetry provider.

Enable the `telemetry-otel` bundle entry with a collector base URL and non-empty application id:

```yaml
- id: telemetry-otel
  disabled: false
  config:
    endpoint: http://<gateway-host>:4318
    agentPlatform: harness
    agentApplicationId: harness-local
```

The provider exports traces to `<endpoint>/v1/traces`. Under this provider, each Agent driver execution exports one `agent.run` root span with nested `gen_ai.chat`, `llm.client`, `mcp.tools.call`, and `mcp.client` spans. The application id marks the root span and every traced gateway request; it is not a credential.

## Model Experience

None, as OTLP export does not alter a model request.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Export is best-effort: an unavailable collector does not persist local spans for later delivery.
