# Harness × Higress Trace 对接进展与协作说明

日期：2026-08-25

## 目的与范围

本文说明 DeepSeek Harness 与 Higress AI 路由、MCP 网关和可观测性系统的 Trace 对接进展，并列出继续完成本机联调及生产落地所需的 Higress 配合事项。

Harness 只将每个 HTTP 响应的 `x-request-id` 和有效 W3C `traceparent` 中的 trace ID 用作关联键。Prompt、会话消息、模型或工具请求/响应正文、API Key、Cookie、JWT、Console 密码和 Trace Query Token 都不会发送到前端、模型 Prompt 或 session 日志。

## 当前方案

Harness 的运行链路与历史反查分离：业务请求走 Higress 数据面；Harness 服务端在响应后异步反查已授权、已脱敏的网关 Span。反查不阻塞 Agent 轮次，浏览器不直接访问 Console、Tempo、Collector 或 Trace Query API。

生产默认方案是 Gateway Trace Query 服务账户：Harness 使用专用 Bearer Token 调用 `${traceIntegrationUrl}/__higress/trace-query/v1`。Token 的权限由 Higress 对 AI 路由、消费者和 MCP 服务的 allow-list 限制。

Higress Console Basic 方案保留为受控部署的可选 Provider，用于已安全持有 Console 管理凭据的环境。它只调用 `${consoleBaseUrl}/v1/observability`，与 Trace Query Provider 二选一，不会在两种凭据之间自动回退。由于 Console Basic 凭据具有较高管理权限，生产环境仍建议使用服务账户方案。

```text
Harness 服务端
  ├─ 模型 / HTTP MCP 请求：traceparent + X-Agent-* → Higress 数据面
  ├─ 响应关联：x-request-id、response traceparent → Harness 本地 session
  ├─ 后台反查：Bearer Trace Query 或 Console Basic → 已授权 Higress Trace
  └─ Trajectory：仅展示脱敏后的网关请求、Span、Token、TTFT 和耗时
```

## 已完成的 Harness 对接能力

| 能力 | 已完成内容 |
| --- | --- |
| 出站 Trace 上下文 | 模型和 HTTP MCP 的实际请求从当前本地 Span 注入 W3C `traceparent`；部署配置提供非空的 `X-Agent-Run-Id`、`X-Agent-Platform` 和 `X-Agent-Application-Id`。stdio MCP 不经过 Higress。 |
| 响应关联 | Harness 在开始消费流式响应前读取并独立保存 `x-request-id`、响应 `traceparent` 及 trace ID；只有 trace ID 的响应也可反查。并发请求各自收集，不使用全局“最近响应”状态。 |
| 本地调用树 | Harness 可导出 `agent.run`、模型和 MCP 的本地 OpenTelemetry Span；网关响应中的 `traceparent` 仅作反查证据，不会成为下一次请求的父上下文。 |
| 反查能力缝 | 已提供统一的 `gatewayTrace` 服务定义，以及 Gateway Trace Query Bearer Provider 和 Higress Console HTTP Basic Provider。两者都支持按 request ID 精确查询、仅 trace ID 查询、Tempo 缺失时的 reconstructed 查询和有界后台重试。 |
| 数据最小化 | 反查结果经过属性 allow-list 过滤后才写入 log-only `gateway/trace` 事件；不会持久化 Authorization、凭据、请求体、响应体或内部工作空间信息。 |
| Trajectory 展示 | 客户端从持久化的脱敏观测构造“网关请求”列表；一条记录对应一个 `higress.gateway.request`，可展开其已授权的模型或 MCP Span 分支，并显示数据来源、状态、耗时和可用的 Token/TTFT。 |
| 部署骨架 | `dsh-higress-trace` bundle 已包含 Trace Query、Console 和 OTLP 三个可配置但默认禁用的行；bundle 本身不内置地址或凭据。 |

上述 Provider 已有覆盖精确反查、trace-only 反查、`tempo_trace_not_found` 的 reconstructed 回退、503 有界重试以及凭据不写入 session 的单元测试。

## 当前本机状态

| 项目 | 状态 |
| --- | --- |
| Higress Console | 已部署，地址为 `http://127.0.0.1:8001`；未登录访问 API 返回 `401 Login required`，符合 Console 鉴权预期。 |
| Higress Web Portal | 已部署，地址为 `http://127.0.0.1:3002`。 |
| Trace 集成入口 | 本机 Harness 使用 `http://127.0.0.1:4318`；OTLP/HTTP protobuf 的完整导出地址为 `http://127.0.0.1:4318/v1/traces`。本机联调将批处理间隔设为 200 ms，以缩短 Tempo 可见等待。 |
| Tempo | 运行在 Docker 内部服务 `higress-tempo:3200`；Harness 不直接连接它。 |
| Console 服务 | 容器名为 `higress-ai-gateway`。 |
| Console 账号 | Higress Secret 中已有 `admin` 管理账号；密码未导出、未记录在本说明中。 |
| Harness 当前 Provider | Web profile 已启用 `@deepseek-ai/dsh-gateway-trace-query`，反查基址为 `http://127.0.0.1:4318/__higress/trace-query/v1`。 |
| Harness Console Provider | `@deepseek-ai/dsh-gateway-trace-console` 已实现但未启用；Harness 尚未配置 Console 用户名和密码的 credential reference。 |
| 本地 OTLP 语义上报 | 已修正此前把 OTLP 导出指向不可达 `172.0.0.1:4318` 的测试配置。每次 Harness Agent driver 执行现在会生成新的 run ID 与 `agent.run` 根 Span；`gen_ai.chat`、`llm.client`、`mcp.tools.call` 和 `mcp.client` 都在同一棵本地 Trace 树内。 |
| 本地端到端验收 | 尚待以真实 Higress AI 路由或 HTTP MCP 调用完成“本地 Span 导出 → 响应关联 → 反查 → Trajectory 展示”的全链路验收。 |

## 待完成工作

### Harness 侧

1. 将 Console 用户名和密码以受信服务端 credential reference 写入 Harness 凭据存储，禁止写入 profile YAML、浏览器配置、日志或仓库。
2. 为本机 Console 联调启用 `@deepseek-ai/dsh-gateway-trace-console`，配置 `consoleBaseUrl: http://127.0.0.1:8001`、用户名引用和密码引用，同时停用 Trace Query Provider，确保一次运行只装载一个反查 Provider。
3. 以真实 Higress AI 路由和至少一个 HTTP MCP 请求运行 Harness，确认响应携带 `x-request-id` 或有效 `traceparent`，并确认后台事件和 Trajectory 的网关请求列表出现对应记录。
4. 用真实 Higress AI 路由和 HTTP MCP 请求验证 OTLP 导出：一个 Agent 执行应在同一 Trace ID 下包含 `agent.run`、`gen_ai.chat`、`llm.client`、`mcp.tools.call`、`mcp.client` 与网关 Span；同一 session 的下一次执行必须使用新的 run ID 和 Trace ID。该导出与 Trace Query Token、Console 密码相互独立。
5. Console 联调完成后，恢复或保留 Trace Query 服务账户作为生产 Provider，并以最小权限 Token 验证相同联调路径。

### Higress 侧

1. 确认 Console 的 HTTP Basic 凭据可由 Harness 服务端安全使用，并提供适合自动化反查的最小权限账号；现有 `admin` 账号仅适合作为本机临时联调凭据，不建议作为生产长期凭据。
2. 为生产创建独立的 Trace Query 服务账户和 Token，并将实际 AI 路由、需要观测的 MCP 服务和必要消费者加入 allow-list；Token 只通过约定的密钥渠道交付给 Harness 服务端。
3. 确认 `traceIntegrationUrl` 对 Harness 运行环境可达，且它与实际 AI 路由和 MCP 网关属于同一 Higress 部署。`4318` 可用于 Trace 集成/OTLP；业务调用仍须使用数据面路由地址。
4. 确认 AI 路由和 HTTP MCP 入口会接收并透传有效 `traceparent`、`X-Agent-Run-Id`、`X-Agent-Platform` 和 `X-Agent-Application-Id`，并在响应头返回可用的 `x-request-id` 和/或 `traceparent`。
5. 确认以下反查路径及错误码语义：按 request ID 查询、按 trace ID 查询、仅在 `404` 且错误码为 `tempo_trace_not_found` 时查询 reconstructed 数据、服务暂不可用时返回 `503`。Harness 只对 `503` 做有界重试。
6. 提供一组可重复的 AI 路由和 HTTP MCP 联调请求，或提供对应的 request ID / trace ID，以便双方确认 Trace 可见性、Span 属性 allow-list 和数据写入时延。
7. 明确 OTLP 接收端的网络访问、TLS/mTLS 和属性脱敏要求；不要将 Collector、Tempo 或 ClickHouse 暴露给 Harness 浏览器客户端。

## 联调验收标准

| 验收项 | 预期结果 |
| --- | --- |
| 响应关联 | 每次受测的 AI 路由或 HTTP MCP 响应至少携带 `x-request-id` 或有效 `traceparent`；Harness 可将其关联到正确的 turn/step。 |
| 本地语义链路 | 每个 Agent driver 执行导出一个新的 `agent.run` 根 Span，模型和 HTTP MCP 子 Span 继承同一 Trace ID；session ID 不作为 `X-Agent-Run-Id` 使用。 |
| 精确反查 | 有 request ID 时，`by-request` 能解析到相同 trace ID；无 request ID 但有 trace ID 时，Harness 直接查询 Trace。 |
| 完整与重建 Trace | Tempo 可用时返回 `tempo` 数据；仅 `tempo_trace_not_found` 触发 reconstructed 查询，其他 404、401、403、400 不跨入口或跨权限回退。 |
| 权限与脱敏 | Harness 只收到已授权 Span 和允许属性；结果中不含 Prompt、正文、凭据、Cookie、JWT、API Key 或内部工作空间标识。缺失未授权父 Span 不视为失败。 |
| 非阻塞性 | Trace 查询在 Agent 主轮次结束后异步执行；503 按配置退避重试，其他不可恢复响应停止尝试。 |
| 用户界面 | Trajectory 以 `higress.gateway.request` 为请求条目，显示其允许的模型/MCP 子分支、数据来源、状态、耗时和可用 Token/TTFT；不将并行 Span 的累计耗时当作用户等待时长。 |
| 凭据隔离 | Trace Query Token 和 Console Basic 凭据只存在于 Harness 服务端凭据存储；不进入 session、Prompt、浏览器、桌面端或可观察日志。 |

## 建议的协作顺序

1. Higress 团队确认本机 Console Basic 自动化访问方式和测试用 AI/MCP 路由。
2. Harness 以 credential reference 启用 Console Provider，完成本机的完整反查和 UI 验收。
3. Higress 团队提供受限 Trace Query 服务账户；Harness 切换回 Trace Query Provider，复跑相同验收用例。
4. 双方确认 OTLP 导出、网络策略和脱敏策略后，将该配置固化到目标环境的受信服务端部署配置。

## 相关实现说明

- [Harness Trace 对接 PRD](docs/gateway-trace-integration-prd.md)
- [Harness 本地 OTLP Span 设计](docs/gateway-trace-otel-design.md)
- [Gateway Trace Query Provider](packages/gateway/gateway-trace-query/README.md)
- [Higress Console Provider](packages/gateway/gateway-trace-console/README.md)
- [Higress Trace bundle](packages/bundle/higress-trace/README.md)
