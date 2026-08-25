# @deepseek-ai/dsh-gateway-trace

[English](README.md) | 中文

`GatewayTraceService`（`ctx.gatewayTrace`）是已脱敏 Higress Trace 反查的 Service Definition。它接收带 `x-request-id` 或 W3C trace id 的响应关联，返回 `GatewayTraceObservation`；它不拥有凭据、HTTP 传输、session 位置或 UI 渲染。

| 角色 | 包 |
| --- | --- |
| Service Definition | `@deepseek-ai/dsh-gateway-trace` |
| 默认 Provider | `@deepseek-ai/dsh-gateway-trace-query` — Gateway 服务账户 Bearer Token |
| 可选 Provider | `@deepseek-ai/dsh-gateway-trace-console` — Console HTTP Basic |
| Consumer | `@deepseek-ai/dsh-client-ui-trajectory` |

Provider 在后台查询成功后追加一个 log-only、`ignorable` 的 `gateway/trace` 事件。存在 request id 时以它作为锚点；只返回有效 trace id 的响应也能成为持久阶段锚点。invariant 要求所提供的关联键与更早的 `assistant/message` 或 `tool/result` 保持一致。

声明的结果只包含 allow-list 网关、模型和 MCP 属性、`tempo` 或 `reconstructed` 来源、由 Span 区间构成的时间，以及用于客户端选择已授权分支的 Span ID、父 Span ID、请求 ID 和开始时间。结果排除消息、工具参数、凭据、HTTP 正文、资源属性、Span 事件、链接和聚合成本。事件绝不进入模型历史，也不改变 `SESSION_FORMAT_VERSION`。

## Model Experience

无，因为 `gateway/trace` 仅用于日志，绝不进入模型历史。

#### KV Cache effect

无。

## 已知限制与暂缓事项

- 网关观测是经授权的局部视图，不能重建外部 Agent Span 或不受限的分布式 Trace 树。
