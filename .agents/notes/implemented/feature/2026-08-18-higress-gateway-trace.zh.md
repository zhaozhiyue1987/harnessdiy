# Agent Note: Higress 网关 Trace 对接

Status: implemented

[English](2026-08-18-higress-gateway-trace.md) | 中文

## 问题

DeepSeek Harness 通过 Higress AI 网关调用模型和 MCP 端点，网关生成 W3C trace 上下文和每次请求 ID。下游应用（包括 Harness 自身）目前无法将自身的 session 事件与网关的可观测数据（token 数、首字时延、成本、模型路由）关联。请求完成后，网关在响应头中暴露 `traceparent` 和 `x-request-id`，并提供只读可观测 API，但 Harness 丢弃了这些响应头，也从未回查。

[Trace 对接规范](../../../../downstream-trace-integration-and-query-guide-v1.0.0.md) 规定了精确的线上契约：外出时注入 `traceparent` + `X-Agent-*` 头、从响应头读取 `traceparent` + `x-request-id`、以 `trace.read` scope 异步调用 `/v1/observability/traces/{traceId}` 等端点。

## 决策

新增 `dsh-gateway-trace` 能力缝，分三层桥接：

1. **外出头注入** — LLM 适配器（`dsh-llm-deepseek`）新增类型化 `RequestTrace` 上下文，由 agent loop 在每次模型请求前从 session 身份填充。适配器将 `traceparent`（W3C 格式，从 harness trace 传播或新生成）和可选 `X-Agent-*` 业务关联头写入 HTTP 请求。MCP 客户端传输（`dsh-mcp-client`）对 Streamable HTTP 和 SSE 传输做同样处理。

2. **响应头捕获** — 每个适配器/传输从 HTTP 响应读取 `traceparent` 和 `x-request-id`，随正常结果一起返回。agent loop 和 MCP 工具桥将这些作为 `traceMeta` 包附加到 `assistant/message` 和 `tool/result` session 事件。

3. **异步可观测查询** — 新增 `dsh-gateway-trace` 插件提供 `GatewayTraceService`，单一方法 `query(requestId: string): Promise<GatewayTraceDetail | undefined>`。按可配置调度或 UI 按需，使用资源归属 JWT（规范中的资源归属模式）调用网关 `/v1/observability/traces/by-request/{requestId}` 端点，然后追加 `gateway/trace` session 事件，携带 token、TTFT、模型和成本数据。

Session 事件载荷：

```ts
// Declared via declaration merging on SessionEventMap in dsh-gateway-trace
'gateway/trace': {
  turn: number
  step: number
  traceId: string
  requestId: string
  modelId: string        // resolved model (gen_ai.response.model)
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cachedTokens?: number
  firstTokenMs?: number  // TTFT
  durationMs: number
  estimatedCost?: string // CNY, from cost/summary
  observedAt: string     // ISO-8601
}
```

鉴权使用**资源归属模式**：网关管理员将 harness 部署注册为具有 `trace.read` scope 的机器客户端，作用域为拥有 AI 路由的工作空间。`GatewayTraceService` 从 `dsh-credentials` 服务读取凭据（env 或 `.credentials.yaml`），不内联任何密钥。

### 线上流

```
Agent Loop
  ├─ LLM request ── headers: {traceparent, X-Agent-Run-Id, X-Agent-Platform} ──▶ Higress
  │                                                          ◀── response: {traceparent, x-request-id}
  ├─ session.append('assistant/message', {..., traceMeta: {traceId, requestId}})
  │
  └─ GatewayTraceService.query(requestId) ──▶ GET /v1/observability/traces/by-request/{id}
                                               GET /v1/observability/traces/{traceId}
                                           ◀── {spans: [{attributes: gen_ai.usage.*}]}
       session.append('gateway/trace', {turn, step, traceId, requestId, inputTokens, ...})
```

## 备选方案

- **响应体中同步返回 token/TTFT。** 网关不会将用量数据注入模型响应体；它异步写入 ClickHouse/Tempo。在流内等待可观测管道会加延迟并破坏流式传输。规范明确说网关不同步返回 token/成本。

- **适配器中轮询。** 让 LLM 适配器在流完成后轮询会将传输层耦合到可观测 API，并阻塞 agent loop 等待可能耗时数秒的网络调用。异步服务设计保持适配器单一职责，让 trace 查询按定时器或 UI 需求进行。

- **在 `tool/result.meta` 中嵌入可观测数据。** MCP 工具结果已携带 `meta` 字段，但网关的 trace 数据是关于 MCP 服务器背后的*模型*调用，而非工具结果本身。混为一谈会错误归属 token 和成本。专用 `gateway/trace` 事件保持所有权清晰。

- **编写网关 Wasm 插件注入响应头。** 超出 Harness 范围；网关团队拥有该面。本设计与网关现状兼容（规范确认 `traceparent` 和 `x-request-id` 已在响应头中）。

## 后果

- Session 日志新增一阶 `gateway/trace` 事件，携带结构化 token、TTFT 和成本数据，可供下游消费者（UI、导出、分析）查询。
- Agent loop 和 MCP 传输每次请求多携带两个字符串头（`traceparent`、`x-request-id`），线上开销可忽略。
- 新增 `dsh-gateway-trace` 包引入 `GatewayTraceService` 和 session 事件类型。`dsh-llm-deepseek` 适配器和 `dsh-mcp-client` 传输各增加一个小的 `RequestTrace` 参数。
- 资源归属鉴权需要一次性管理步骤：注册具有 `trace.read` scope 的网关客户端并将凭据存入 `$DSH_HOME/.credentials.yaml`。服务在未配置凭据时优雅降级（记录警告，返回 `undefined`）——无数据，不崩溃。
- `gateway/trace` 事件是模型可见的（进入 session 日志），因此 `SESSION_FORMAT_VERSION` 将按版本机制递增。

## 范围

本说明覆盖前两层（头注入和响应捕获）作为 MVP。异步可观测查询（`GatewayTraceService`）为后续；此处设计事件类型和线上契约以保持稳定，但实现延至第二个 PR。

## 测试

- 头注入单元测试：LLM 适配器收到 `RequestTrace` 并写入正确的 `traceparent` 和 `X-Agent-*` 头。
- 响应头捕获单元测试：带 `traceparent` 和 `x-request-id` 头的 mock 响应产生预期的 `assistant/message` 上的 `traceMeta`。
- `gateway/trace` 事件载荷形状单元测试（schema 验证）。
- 异步查询服务使用 mock 网关可观测端点测试。
- 无快照：`gateway/trace` 事件是新增的，除 session 日志条目外不添加模型可见呈现。
