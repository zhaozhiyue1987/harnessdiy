# Agent Note: Harness 本地 OTLP Trace 树

Status: proposed

English | [中文](2026-08-24-harness-local-otel-trace-tree.zh.md)

## Problem

Harness 当前向 Higress 发送本地生成的 W3C Span ID，却未导出对应的本地 Span；同时还把模型响应的 `traceparent` 当作后续 MCP 请求的父级。Tempo 因而只含网关分支及无法解析的 Harness 父节点，MCP 也会显示在模型网关请求之下，而非触发它的 Harness 工具调用之下。辅助标题模型调用绕开 agent-loop 的 request-trace 构造，可能创建独立网关 Trace。

## Proposal

引入 telemetry 能力及其 OTLP Provider。它拥有运行内异步上下文，创建并导出 `agent.run`、`gen_ai.chat`、`llm.client`、`mcp.tools.call`、`mcp.client` Span，并从当前本地 client Span 为每一次实际 HTTP 请求注入上下文。Provider 只接受受信服务端的部署配置，其中包含非空应用标识和 OTLP endpoint。

网关响应头保持为精确反查的 `GatewayResponseCorrelation` 证据。它记录响应 traceparent、request id、trace id、本地 client Span id、run id 和接收时间，绝不替换活动本地上下文。Gateway Trace Query 继续只展示已授权网关事实，并通过关联键将它们挂到本地 Span 树。

标题、模型发现、预检、重试、流式和 MCP 协议请求使用相同 telemetry 入口。不能暴露每次 HTTP 尝试的第三方 SDK 重试必须关闭或替换为 Harness 自有重试。

Trajectory 将网关反查结果作为独立展示 Consumer：`higress.gateway.request` 是一条真实请求记录，安全的 Span ID、父 Span ID 和时间仅用于在客户端构造该记录的已授权分支。列表优先显示模型与 MCP 网关请求；点击后才构造分支详情。该 Consumer 不直连网关或 OTLP，不获取凭据，不改变 Session 格式，并可随 UI bundle 独立卸载。

## Alternatives considered

- **将模型响应 `traceparent` 作为 MCP 父级。** 拒绝：它指向已完成的 Higress server Span，不是本地工具操作，会使 MCP 网关请求成为前一模型网关请求的子节点。
- **只保留 W3C 透传，不导出本地 Span。** 拒绝：Tempo 会保留对未上报 Harness 父节点的引用，无法重建预期本地树。
- **依赖 Gateway Trace Query 返回完整 UI 树。** 拒绝：服务账户会主动过滤外部 Harness Span 和未授权父节点。
- **在 agent-loop 或 Gateway Provider 内预组装 UI 分支。** 拒绝：这会将展示策略耦合到运行时和服务端查询，并让未打开的详情增加加载与持久化成本。

## Acceptance criteria

- 一次包含两次模型调用和一次 HTTP MCP 调用的运行只使用一个 trace id；没有 gateway-created 请求，所有请求携带相同 run id 和非空 application id。
- Tempo 包含本地语义 Span 树，MCP 网关请求是匹配本地 `mcp.client` Span 的子节点。
- 响应关联永不改变当前本地父级；并发工具和多协议请求保持独立上下文与关联记录。
- 标题、探测、重试、流和 MCP HTTP 路径都创建可观测尝试；无法满足时在加载或配置阶段失败。
- Gateway Trace Query 过滤外部父节点时，本地 UI 树仍完整，网关事实继续按请求关联并保持脱敏。
- 网关列表只显示真实网关请求，分支在选中时由已授权 Span 构造；浏览器不新增反查、OTLP 或鉴权网络请求。

## Risks

- OTLP 可用性不得阻塞 Agent。Provider 需要有界异步导出、卸载取消和不含凭据的安全诊断。
- 在错误 SDK 层级插桩会遗漏自动重试或生成重复 Span。实现前必须证明 hook 每次 HTTP 尝试均执行，才能保留 SDK 重试。
