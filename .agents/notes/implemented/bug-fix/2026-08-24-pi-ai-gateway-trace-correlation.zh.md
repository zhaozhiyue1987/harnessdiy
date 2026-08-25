# Agent Note: Pi-AI 网关 Trace 关联

Status: implemented

[English](2026-08-24-pi-ai-gateway-trace-correlation.md) | 中文

## Problem

当前启用的 `llm-pi-ai` 路由可以经 Higress 发送模型流量，但未消费 `GenerateOptions.requestTrace`，也未保存响应关联。HTTP MCP 请求因此只有步骤 Trace 上下文，缺少返回的模型 Span 上下文，网关数据无法建立预期的模型到 MCP 父子关系，也无法可靠锚定模型 Token 观测。

## Decision

`dsh-llm-pi-ai` 在 `GenerateOptions.requestTrace` 存在时消费它。它在 profile headers 之后写入 W3C `traceparent` 和可选 `X-Agent-*` 字段，使部署配置不能抑制或替换 Harness 关联头。

适配器使用 pi-ai 通用的 `onResponse` 回调，在消费流内容前解析 HTTP 响应头。仅当响应提供有效 `traceparent` 或非空 `x-request-id` 时，它才在首个模型内容分片前发出一项 `trace-meta`。它绝不从出站上下文、流载荷或共享可变状态推导响应关联。

agent loop 将返回的模型 `traceparent` 作为后续 HTTP MCP 请求的父上下文。缺少它时，模型和 MCP 调用保持同一 trace id 的对等关系，Trajectory 标记为仅同 Trace。这扩展了[Higress 网关 Trace 集成](../feature/2026-08-18-higress-gateway-trace.md)所描述的已启用集成。

## Alternatives considered

- **在 agent loop 包装全局 fetch。** pi-ai 拥有自己的 HTTP 客户端；全局包装会捕获无关流量，也会遗漏使用其他传输的适配器。
- **从出站 traceparent 生成模型 `trace-meta`。** 请求头不能证明 Higress 已接受、记录或分配响应关联。
- **只保留 HTTP MCP 透传。** 它可以按本地生成的 trace id 聚合调用，但不能把返回的模型 Span 建为 MCP 父节点。

## Consequences

pi-ai 的 OpenAI-compatible 与 pi-messages 路径共享同一请求头和响应关联行为。有效响应关联会在内容前成为一项 `trace-meta`，缺失或无效响应头不生成伪造关联。聚焦的适配器、agent loop 和 MCP transport 测试固定了透传和仅同 Trace 行为。

Higress 可能省略响应关联头。此时 Harness 保留 trace-id 聚合，但不能呈现已验证的模型到 MCP 父子关系。AI/MCP 部署或 allow-list 之外的 Trace Query 账户同样不产生授权事实；应用只报告无数据，不泄露凭据或尝试跨资源枚举。
