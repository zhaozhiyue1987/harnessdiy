# Agent Note: Higress 网关 Trace 对接

Status: implemented

[English](2026-08-18-higress-gateway-trace.md) | 中文

## 问题

Harness 需要将 Agent 阶段与已授权的 Higress 模型或 MCP Trace 事实持久关联，同时不能暴露内部存储、Prompt、工具参数或凭据。线上依据是 [v1.2 Trace 指南](../../../../../higress/docs/integration/trace-integration-and-reverse-query-guide-v1.2.md) 与 [Harness 适配指南](../../../../../higress/docs/integration/harness-higress-trace-adaptation-guide-v1.md)。

## 决策

`dsh-gateway-trace` 能力缝由 Service Definition、默认 `dsh-gateway-trace-query` 服务账户 Provider、可选 `dsh-gateway-trace-console` Basic Provider 和 Trajectory Consumer 组成。两个 Provider 都接收独立捕获的 `x-request-id` 或 W3C trace id。

每次 Agent driver 执行都会创建一个不透明 run id 和一个 `agent.run` 根 Span。嵌套的 `gen_ai.chat`、`llm.client`、`mcp.tools.call` 与 `mcp.client` Span 共享该根；每个模型和 HTTP MCP 请求都会注入当前 client Span 的 `traceparent`，并携带同一 `X-Agent-Run-Id`、平台和应用 header。响应关联只为反查保存有效的返回 `traceparent`、其 trace id、可选 request id 与接收时间。网关响应绝不成为本地父上下文。每次 MCP 派发拥有独立 async-local 收集器，因此并发工具和协议请求不会覆盖其他响应关联。

默认 Provider 使用凭据引用解析出的 Trace Query Bearer Token 调用 Gateway `/__higress/trace-query/v1`；Console Provider 使用凭据引用解析出的 HTTP Basic 调用 Console `/v1/observability`。两者绝不交换凭据或跨授权模型回退。Provider 通过 `by-request` 解析 request id，或直接使用 trace id；随后查询 `traces/{traceId}`，且只在 `tempo_trace_not_found` 后请求 reconstructed 数据。

Provider 只追加经 request id（存在时）或 trace id 锚定、已脱敏且 ignorable 的 `gateway/trace` 事件。事件保留 allow-list 的网关、模型和 MCP 属性、数据来源（`tempo` 或 `reconstructed`）和区间并集时间。Trajectory 与 Harness 本地用量并列展示返回的 Span 用量和 MCP 事实，但不做聚合。Provider 绝不保留请求或响应正文、Prompt、工具参数、Authorization、Cookie、凭据、内部归属字段，或归属到单阶段的聚合成本。

## 后果

- `gateway/trace` 仅用于日志，不改变 `SESSION_FORMAT_VERSION` 或模型历史。
- invariant 要求更早的响应关联中提供的 request id 和 trace id 均匹配；只有 trace id 的响应也能锚定观测。
- 查询异步执行，具备有界并发和有限退避；凭据缺失或无数据时不追加观测。
- 一个会话可以有多次 driver 执行；每次执行都获得独立 run id 和根 Trace，不复用会话 id。
- 服务账户结果可省略父 Span、外部 Agent Span 或未授权并行分支；Consumer 不将该省略视为链路失败。
- Console 成本汇总仍是独立的显式聚合能力，不写入阶段观测。

## 备选方案

- **直连 Collector、Tempo 或 ClickHouse。** 这些是内部部署面，且会绕过受支持的授权模型。
- **模块级响应槽位。** 并发 MCP 协议请求无法通过共享“最近值”正确归属。
- **默认使用 Console Basic。** 它带有 Console 管理权限；服务账户 allow-list 才是生产环境最小权限对接。
- **在 Agent loop 同步反查。** Trace 存储最终一致，不得增加用户可见轮次延迟。

## 验证

- 单元覆盖独立响应头、只有 trace id 的阶段反查、本地 Agent／LLM／MCP Span 嵌套、每次执行的 run 身份、并发收集器、Basic 与 Bearer 凭据、OTLP 与 reconstructed 载荷、allow-list 过滤、显式 Tempo 回退和 Token 渲染。
- Provider 与 Trajectory 类型检查覆盖 Service Definition、持久化事件和 Consumer 边界。
