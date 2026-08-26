# Harness × Higress 单向 Trace 对接说明

## 当前方案

Harness 使用 `dsh-telemetry` 与 `dsh-telemetry-otel` 导出本地语义 Span 到 Higress OTLP 入口。MCP 服务由 `dsh-mcp-manager` 管理，模型和 HTTP MCP 调用均向 Higress 透传同一执行链路的 W3C 上下文。

Harness 不包含 Gateway Trace Query、Higress Console Provider、响应头关联、`gateway/trace` 会话事件或 Trajectory 网关反查界面。它不需要任何 Higress 查询凭据，也不会从网关回读 Trace 数据。

## 已完成

| 范围 | 内容 |
| --- | --- |
| 本地链路 | 每次 Agent 执行有独立 `agent.run` 和 run ID；模型、MCP 语义 Span 在同一 Trace 下。 |
| 请求上下文 | 模型与 HTTP MCP 请求携带当前 `traceparent` 和 `X-Agent-Run-Id`、`X-Agent-Platform`、`X-Agent-Application-Id`。 |
| 导出 | OTLP/HTTP 导出地址为 `http://<gateway-host>:4318/v1/traces`。 |
| MCP 管理 | `dsh-mcp-manager` 管理已配置 MCP 服务；`dsh-mcp-client` 将服务调用接入 Agent 工具。 |

## 需要 Higress 配合

1. 提供 OTLP/HTTP 入口、网络访问和 TLS/mTLS 规范。
2. 确认 AI 路由和 HTTP MCP 入口会接收并关联 W3C `traceparent` 与 `X-Agent-*` 头。
3. 提供一组可重复的模型路由和 HTTP MCP 联调请求，用于在 Higress 侧验证一棵完整 Trace 树。
4. 明确网关侧 Trace 属性脱敏要求；不要将 Prompt、请求正文、响应正文或凭据写入可观测属性。

## 不在范围内

Trace Query 服务账户、Console Basic 凭据、Tempo/Console API 查询、响应头关联、会话持久化观测结果、Harness 内的 Trace 反查 UI，以及任何数据回传。
