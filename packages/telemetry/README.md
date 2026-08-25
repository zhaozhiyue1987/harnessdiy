# telemetry/ — local Trace capability family

English | [中文](README.zh.md)

The telemetry family creates Harness-owned semantic spans and exports completed spans through OTLP. It is optional: consumers keep their existing request behavior when no provider is mounted. A provider supplies the configured platform and application identity for both local Agent spans and outbound gateway headers.

| Package | Role | ctx key |
| --- | --- | --- |
| [`telemetry/`](telemetry/README.md) | TraceTelemetry Service Definition and W3C context contract | `ctx.traceTelemetry` |
| [`telemetry-otel/`](telemetry-otel/README.md) | OTLP/HTTP protobuf provider | `ctx.traceTelemetry` |

Gateway response correlation and reverse queries belong to the separate [gateway family](../gateway/README.md); telemetry does not store responses or render a Trace UI.
