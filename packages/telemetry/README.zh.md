# telemetry/ — 本地 Trace 能力家族

[English](README.md) | 中文

telemetry 家族创建 Harness 自有的语义 Span，并经由 OTLP 导出已结束的 Span。它是可选能力：未挂载 Provider 时，Consumer 保持原有请求行为。Provider 提供配置的平台与应用标识，同时用于本地 Agent Span 和出站网关 header。

| 包 | 角色 | ctx key |
| --- | --- | --- |
| [`telemetry/`](telemetry/README.md) | TraceTelemetry Service Definition 与 W3C 上下文约定 | `ctx.traceTelemetry` |
| [`telemetry-otel/`](telemetry-otel/README.md) | OTLP/HTTP protobuf Provider | `ctx.traceTelemetry` |

网关响应关联与反查属于独立的 [gateway 家族](../gateway/README.md)；telemetry 不存储响应，也不渲染 Trace UI。
