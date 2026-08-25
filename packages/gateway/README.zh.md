# gateway/ — Higress Trace 能力家族

[English](README.md) | 中文

gateway 家族在 Agent 请求完成后记录脱敏的 Higress 事实。`gateway-trace` 定义 `ctx.gatewayTrace` 与仅写入日志的观测事件；部署只能选择一个反查 Provider。Client 只消费已持久化的观测，绝不调用 Higress API 或获得查询凭据。

| 包 | 角色 | ctx key |
| --- | --- | --- |
| [`gateway-trace/`](gateway-trace/README.md) | 脱敏 Trace 查询服务与观测类型 | `ctx.gatewayTrace` |
| [`gateway-trace-query/`](gateway-trace-query/README.md) | Gateway Trace Query 服务账户 Provider | `ctx.gatewayTrace` |
| [`gateway-trace-console/`](gateway-trace-console/README.md) | Higress Console HTTP Basic Provider | `ctx.gatewayTrace` |

Provider 约定、授权限制与响应关联规则由 [gateway-trace](gateway-trace/README.md) 负责；本地语义 Span 与 OTLP 导出由独立的 [telemetry 家族](../telemetry/README.md)负责。
