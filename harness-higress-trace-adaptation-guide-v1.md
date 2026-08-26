# Harness 接入 Higress 单向 OTLP Trace 指南

Harness 只向 Higress 导出 Trace，不调用 Trace Query API、Higress Console 或 Tempo，也不读取或持久化网关响应头。

## Harness 行为

- 每次 Agent 执行创建唯一 `agent.run` 根 Span 和唯一 run ID。
- 在根 Span 下导出 `gen_ai.chat`、`llm.client`、`mcp.tools.call` 与 `mcp.client` Span。
- 每个模型与 HTTP MCP 请求使用当前本地 client Span 的 W3C `traceparent`，并携带 `X-Agent-Run-Id`、`X-Agent-Platform: harness`、`X-Agent-Application-Id`。
- Span 通过 OTLP/HTTP 发送到 `http://<gateway-host>:4318/v1/traces`。
- 异步工具、SSE 和任务调度必须显式继承 OpenTelemetry 上下文，避免另起 Trace。

stdio MCP 不经由 Higress 时不会产生网关请求，但其上层工具 Span 仍会导出。

## Harness 配置

```yaml
- id: telemetry-otel
  name: '@deepseek-ai/dsh-telemetry-otel'
  config:
    endpoint: http://<gateway-host>:4318/v1/traces
    agentPlatform: harness
    agentApplicationId: <application-id>
```

不配置任何 Trace Query Token、Console Basic 凭据或反查 Provider。

## Higress 需要配合

1. 提供 Harness 运行环境可访问的 OTLP/HTTP 接收地址，明确 TLS/mTLS 和网络策略。
2. 确认模型路由与 HTTP MCP 入口接收并关联有效的 `traceparent` 与 `X-Agent-*` 头。
3. 在 Higress Console 或 Tempo 中按同一 Trace ID 验收：Harness 本地 Span 与 `higress.gateway.request`、模型或 MCP 网关 Span 位于同一棵 Trace 树。
4. 对模型、MCP、Prompt 和凭据属性执行网关侧脱敏策略；Harness 不回传请求或响应正文。

## 验收

一次包含模型和 HTTP MCP 调用的 Agent 执行，在一个 Trace ID 下至少包含 `agent.run`、`gen_ai.chat`、`llm.client`、`mcp.tools.call`、`mcp.client` 及对应的 Higress 网关 Span。下一次 Agent 执行必须产生新的 run ID 和新的 Trace ID。
