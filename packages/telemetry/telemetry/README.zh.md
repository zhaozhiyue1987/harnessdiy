# @deepseek-ai/dsh-telemetry

[English](README.md) | 中文

`TraceTelemetry`（`ctx.traceTelemetry`）是本地 Trace 树的可选 Service Definition。Consumer 通过 `ctx.get('traceTelemetry')` 取得它，因此未加载 telemetry Provider 的部署会保持原有请求行为。Provider 提供部署的平台与应用标识，Consumer 用它们标记 `agent.run` 属性，并与每个网关请求的 `X-Agent-*` header 保持一致。

| 角色 | 包 |
| --- | --- |
| Service Definition | `@deepseek-ai/dsh-telemetry` |
| OTLP Provider | `@deepseek-ai/dsh-telemetry-otel` |
| Consumer | Agent loop、MCP client 和 session-title LLM |

该服务创建本地 Span，在异步工作中传播其 W3C 上下文，并暴露一次出站请求所需的活动上下文。它不查询 Higress、不存储网关响应，也不渲染 Trace UI。

## Model Experience

无，因为本地 Trace 上下文不改变模型请求。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 部署未挂载 `TraceTelemetry` Provider 时，不会产生本地 Span。
