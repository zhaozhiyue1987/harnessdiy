# Agent Note: Higress 单向 OTLP 链路

Status: implemented

[English](2026-08-26-higress-one-way-otlp-tracing.md) | 中文

## Problem

Harness 需要向 Higress 发送连贯的 Agent、模型和 MCP Trace 上下文，同时保持运行时不依赖 Higress 查询 API、Console 凭据或响应负载。

## Decision

`dsh-telemetry` 和 `dsh-telemetry-otel` 负责本地语义 Span 与 OTLP 导出。每次 Agent driver 执行创建一个带唯一 run id 的 `agent.run` 根 Span，其下包含 `gen_ai.chat`、`llm.client`、`mcp.tools.call` 与 `mcp.client` Span。模型和 HTTP MCP 请求注入活动 client Span 的 W3C `traceparent`，以及配置的 `X-Agent-Run-Id`、`X-Agent-Platform` 和 `X-Agent-Application-Id` 头。

运行时不读取或持久化响应 `traceparent` 或 request-id 头。它不包含 gateway-trace 服务、Trace Query 或 Console Provider、反查 bundle、网关 session 事件或 Trajectory 网关视图。Higress 在配置的端点接收 OTLP 数据，并且是唯一的 Trace 查询入口。

## Alternatives considered

- **只做 W3C 透传而不导出本地 Span。** 拒绝：Higress 会收到其后端中不存在的 Harness 父 Span。
- **Gateway Trace Query 或 Console 反查。** 拒绝：当前部署不需要数据回传，反查还会引入查询凭据、session 记录和 UI 代码。
- **将网关响应 Span 作为后续请求的父级。** 拒绝：它是已完成的远程 Span，不是发起后续请求的本地模型或工具操作。

## Consequences

- 部署只需要 OTLP endpoint 以及非敏感的平台和应用标识即可启用追踪。
- MCP 管理保持独立：`dsh-mcp-manager`、`dsh-mcp-client` 和 MCP bundle 管理配置的 MCP 服务与调用。
- 在 Higress 或其配置的后端调查 Trace；Harness 不提供逐请求反查 UI。

## Verification

- 聚焦测试验证 W3C header 注入，以及本地 Agent、模型和 MCP Span 嵌套。
- 源码树不包含 gateway-trace 包、反查配置、响应关联流分片或网关 Trace session 事件。
