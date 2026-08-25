# @deepseek-ai/dsh-telemetry-otel

[English](README.md) | 中文

此 Provider 使用 OpenTelemetry 的 OTLP/HTTP protobuf exporter 实现 `TraceTelemetry`。它维护独立的异步上下文管理器，因此挂载它不会替换其他插件的进程全局 OpenTelemetry provider。

启用 `telemetry-otel` bundle 条目，并提供 Collector 基地址和非空 application id：

```yaml
- id: telemetry-otel
  disabled: false
  config:
    endpoint: http://<gateway-host>:4318
    agentPlatform: harness
    agentApplicationId: harness-local
```

Provider 将 Trace 导出至 `<endpoint>/v1/traces`。在该 Provider 下，每次 Agent driver 执行都会导出一个 `agent.run` 根 Span，以及其下的 `gen_ai.chat`、`llm.client`、`mcp.tools.call` 和 `mcp.client` Span。application id 会标记根 Span 并注入每个已追踪的网关请求；它不是凭据。

## Model Experience

无，因为 OTLP 导出不改变模型请求。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 导出采用尽力而为模式：Collector 不可用时，本地 Span 不会为稍后投递而持久化。
