# @deepseek-ai/dsh-gateway-trace-query

[English](README.md) | 中文

`dsh-gateway-trace-query` 是 `ctx.gatewayTrace` 的默认受信服务端 Provider。它使用凭据引用解析出的 Bearer 服务账户 Token 调用 Higress Gateway `/__higress/trace-query/v1`，返回的 Trace 受该账号的路由、消费者和 MCP 服务 allow-list 限制。

配置 `traceQueryBaseUrl` 和 `tokenRef`；`reflect` 默认开启。`retry` 控制有界后台尝试、延迟和并发。Provider 同时接受 `x-request-id` 与 W3C trace id；只有存在 request id 时才调用 `by-request`，且只在 `tempo_trace_not_found` 后使用 reconstructed 数据。

Provider 仅将 allow-list Span 属性写入 log-only `gateway/trace` 事件，也会记录只有 trace id 的响应关联。它绝不保存 Token、Prompt、工具参数、响应正文、Authorization 或内部归属字段。凭据缺失或无可用数据时不追加事件；卸载时会中止活跃 HTTP 工作并清空待执行反查。

## Model Experience

无，因为网关观测是 ignorable session 记录，不进入派生消息。

#### KV Cache effect

无；Provider 不改变 Prompt 前缀。

## 已知限制与暂缓事项

- 服务账户不能查询 Higress allow-list 之外的路由、消费者或 MCP 服务数据。
