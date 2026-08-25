# Higress Trace 链路与反查适配规范 v1.1

> 适用对象：通过 Higress 调用 AI 路由或 MCP 服务、并需要将自身 Agent / 应用链路关联进 Trace 的外部平台。
>
> 版本状态：**当前实现基线**（2026-08-24）。本文以 `downstream-trace-integration-and-query-guide-v1.0.0.md` 为基础，已按实际运行代码校正鉴权、降级和时间口径。
>
> 本文是 `docs/integration/` 唯一的对外 Trace 接入与反查规范。历史方案请见 [archive/2026-08-24](archive/2026-08-24/)。

---

## 1. 先看结论

一次受支持的对接有两条独立链路：

```text
业务调用：外部平台 ── traceparent / X-Agent-* ──> Higress 数据面 ──> 模型或 MCP
                                                          │
                                                          ├─ 网关审计事实（ClickHouse）
                                                          └─ OTLP Span（Tempo）

异步反查：外部平台服务端 ── HTTP Basic / Console Cookie ──> Console :8001
                                                          └─ 服务端代理 Collector :8089
```

1. 对模型或 MCP 的业务调用发送到**网关入口**（例如 `http://<gateway-host>:8080/aaa/v1/chat/completions`），而非 Console。
2. 调用时建议透传 W3C `traceparent`，并可增加 `X-Agent-*` 业务关联头。
3. 响应中保存 `traceparent` 与 `x-request-id`；两者是后续定位的关联键。
4. 反查只能访问 **Console 的 `/v1/observability/*`**，不要将 Tempo、ClickHouse、Collector 或 OTLP 接收端暴露给外部调用方。
5. 当前实现的反查鉴权是 **Console 会话 Cookie 或 HTTP Basic Auth**。`Bearer` JWT 与 `trace.read` scope 不是当前对外可用契约，不能据此实现客户端。

## 2. 地址与信任边界

| 组件 | 用途 | 外部平台是否直接调用 |
|---|---|---|
| Higress 数据面 `http(s)://<gateway-host>:8080` | AI 路由、MCP 网关入口 | 是，按路由配置鉴权 |
| Console `http(s)://<console-host>:8001` | 历史调用、Trace、成本只读反查 | 是，仅服务端且需要 Console 鉴权 |
| Telemetry Collector `:8089` | Console 的内部数据代理 | 否 |
| Tempo `:3200` / ClickHouse / Prometheus | 内部存储和运维 | 否 |
| OTLP 接收端 `:4317/:4318` | 外部平台上报自己的 Span | 仅受信网络；当前本地部署只绑定 `127.0.0.1` |

生产环境应将 Console 和数据面放在 HTTPS 后面。浏览器或桌面客户端不得保存 Console Basic 密码，也不得直连反查接口；应由平台的服务端适配器代为调用。

## 3. 标准适配架构与配置

### 3.1 推荐：平台服务端适配器

外部平台部署一个服务端 `higress-observability-adapter`，负责：

- 在出站模型/MCP 请求上注入并透传 Trace 上下文；
- 从响应头持久化 `traceparent`、`x-request-id` 与自己的 `run_id`；
- 使用 Console Basic 凭证反查，向本平台前端只返回已脱敏的结果；
- 可选地通过 OTLP 导出平台自己的 `agent.run`、`gen_ai.chat`、`mcp.tools.call` Span。

建议配置如下（凭证由密钥管理系统注入，不要提交到仓库）：

```yaml
higress:
  gatewayBaseUrl: https://gateway.example.com
  consoleBaseUrl: https://console.example.com
  consoleAuth:
    type: basic
    username: ${HIGRESS_CONSOLE_USERNAME}
    password: ${HIGRESS_CONSOLE_PASSWORD}
  trace:
    propagateW3C: true
    storeResponseHeaders:
      - traceparent
      - x-request-id
    agent:
      platform: acme-agent-platform
      applicationId: order-assistant
otel:
  enabled: true
  serviceName: order-assistant
  exporterOtlpHttpEndpoint: http://otel-collector:4318
  exporterProtocol: http/protobuf
```

其中 `gatewayBaseUrl` 与 `consoleBaseUrl` 可以是不同域名；不要用数据面 `:8080` 代替 Console `:8001` 查询历史数据。

### 3.2 机器调用 Console 的标准鉴权

Console 接口当前接受以下两种方式：

- 已登录 Console 的 Cookie（仅适用于 Console 浏览器）；
- `Authorization: Basic <base64(username:password)>`（服务端适配器推荐）。

`Authorization: Bearer <JWT>`、`trace.read`、`/identity/v1/token:delegate` 不是当前实现的反查鉴权方式。若未来引入专用服务账户或 OAuth，应以新版本规范替换本节，而非让调用方猜测兼容性。

```bash
export HIGRESS_CONSOLE_URL='https://console.example.com'
export HIGRESS_CONSOLE_USERNAME='${injected-at-runtime}'
export HIGRESS_CONSOLE_PASSWORD='${injected-at-runtime}'

curl --fail-with-body --silent --show-error \
  --user "$HIGRESS_CONSOLE_USERNAME:$HIGRESS_CONSOLE_PASSWORD" \
  "$HIGRESS_CONSOLE_URL/v1/observability/traces/recent?limit=10&exclude_probes=true"
```

Basic 凭证目前等同于 Console 管理员会话能力，必须只放在受信服务端、最小化网络可达范围，并通过密钥轮换管理。它不能下发到浏览器、移动端、桌面端或 Agent Prompt。

## 4. 调用链路接入

### 4.1 W3C Trace Context

支持 OpenTelemetry 的平台应创建自己的根 Span，并让 SDK 自动注入：

```text
traceparent: 00-<32 位小写十六进制 trace-id>-<16 位小写十六进制 span-id>-01
```

Higress 保留该 trace-id，创建 `higress.gateway.request`，并把上下文传给模型/MCP 上游。若未发送该头，网关会建立新 Trace；这不阻塞调用，但平台侧自己的 Span 无法与其形成父子树。

允许的业务关联头如下。它们用于关联与检索，不参与身份或工作空间授权：

| 请求头 | 含义 | 建议值 |
|---|---|---|
| `X-Agent-Run-Id` | 外部平台的一次运行 ID | UUID / 平台 run ID |
| `X-Agent-Platform` | 平台标识 | `acme-agent-platform` |
| `X-Agent-Application-Id` | 应用标识 | `order-assistant` |

不要发送 `X-User-*`、`X-Workspace-*` 来声明归属；网关不会信任它们。不要在 Span 或这些头中放入 Prompt、消息正文、工具参数、Cookie、API Key、JWT 或任何凭证。

### 4.2 AI 路由调用示例

假设 AI 路由前缀为 `/aaa`，其标准 OpenAI 兼容调用为：

```bash
TRACE_ID='0123456789abcdef0123456789abcdef'
PARENT_SPAN_ID='0123456789abcdef'
TRACEPARENT="00-${TRACE_ID}-${PARENT_SPAN_ID}-01"

curl -i --silent --show-error \
  'https://gateway.example.com/aaa/v1/chat/completions' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H "traceparent: ${TRACEPARENT}" \
  -H 'X-Agent-Run-Id: run-20260824-001' \
  -H 'X-Agent-Platform: acme-agent-platform' \
  -H 'X-Agent-Application-Id: order-assistant' \
  -d '{
    "model": "<model-name>",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

模型路由所需的消费者/API Key 鉴权按该路由实际配置补充；它与 Console 反查 Basic 鉴权是两套不同的凭证，不能混用。

### 4.3 MCP 调用

调用 MCP 网关入口（例如 `https://gateway.example.com/mcp-servers/<server-name>`）时同样透传 `traceparent` 和 `X-Agent-*`。MCP 的具体 JSON-RPC/Streamable HTTP/SSE 报文由目标 MCP 服务协议决定；适配器应只负责透传上述 HTTP 头，不要把工具参数复制到 Span 属性。

一次 `mcp.tools.call` 可能触发多次底层 `higress.gateway.request` / `higress.mcp.call`，例如初始化、请求、流式响应或会话请求。这是正常的协议行为。

### 4.4 保存响应关联键

网关 Trace 上下文插件会在响应中回写：

| 响应头 | 用途 |
|---|---|
| `traceparent` | 提取其中第二段的 32 位 trace-id，用于 Span 明细查询 |
| `x-request-id` | 精确定位一次网关请求 |

适配器至少持久化下列记录：

```json
{
  "platformRunId": "run-20260824-001",
  "gatewayRequestId": "<x-request-id>",
  "traceparent": "00-<trace-id>-<span-id>-01",
  "traceId": "<trace-id>",
  "receivedAt": "2026-08-24T02:10:00Z"
}
```

若应用使用流式响应，应在读取流结束前保存 HTTP 响应头，不能只依赖最终 SSE 事件。

## 5. 对外反查 API

公共基址为 `${HIGRESS_CONSOLE_URL}/v1/observability`。成功时 Observability Controller 直接返回 Collector 的 JSON；认证或 Console 层异常可能返回标准包装 `{ "success": false, "message": "...", "data": null }`。

| 方法 | 路径 | 用途 | 关键参数 |
|---|---|---|---|
| GET | `/traces/recent` | 当前 Console 工作空间的近期 Trace 索引 | `limit` 1–50，默认 12；`offset`；`exclude_probes=true` |
| GET | `/traces/search` | 对 allow-list 字段模糊检索 | `q`、`limit`、`offset`、`exclude_probes` |
| GET | `/traces/by-request/{requestId}` | 由响应头 `x-request-id` 精确反查 | 无 |
| GET | `/traces/{traceId}` | 查询 Tempo 中的完整 Trace | 无 |
| GET | `/traces/reconstructed/{traceId}` | 从网关审计事实重建可用 Span | 无；仅完整 Trace 不可用时调用 |
| GET | `/traces/authorize/{traceId}` | 判断当前工作空间是否可见该 Trace | 无 |
| GET | `/cost/summary` | 当前工作空间成本/Token 聚合 | 见 §5.4 |

所有反查都由 Console 当前用户的工作空间约束。不能在请求中传 workspace ID 以跨工作空间查询。

### 5.1 推荐反查顺序

```text
x-request-id
  └─ GET /traces/by-request/{requestId}
      └─ traceId
          └─ GET /traces/{traceId}
              ├─ 200：使用 Tempo 完整 Span
              └─ 404 tempo_trace_not_found：GET /traces/reconstructed/{traceId}
```

`/traces/{traceId}` 当前**不会自动**返回重建结果。客户端应只在该接口返回 Trace 不存在时请求 `/reconstructed`；重建结果带有：

```json
{
  "reconstructed": true,
  "notice": "tempo_trace_unavailable_reconstructed_from_gateway_facts"
}
```

它只包含可从网关审计事实恢复的 Span，不能替代外部平台自行导出的 `agent.run`、`gen_ai.chat`、`mcp.tools.call`。

### 5.2 Trace 索引响应

`/traces/recent` 和 `/traces/search` 返回：

```json
{
  "traces": [
    {
      "traceId": "0123456789abcdef0123456789abcdef",
      "requestId": "2d7694b5-...",
      "eventType": "model_call",
      "routeId": "ai-route-zhaozy.internal",
      "modelId": "deepseek-v4-flash",
      "mcpServiceId": "",
      "statusCode": 200,
      "durationMs": 13046,
      "observedAt": "2026-08-24T02:10:00.000Z",
      "traceOrigin": "inherited",
      "agentRunId": "run-20260824-001",
      "agentPlatform": "acme-agent-platform",
      "agentApplicationId": "order-assistant"
    }
  ],
  "total": 1
}
```

`durationMs` 是该 Trace 中审计到的**最长单请求**，用于列表定位，不是所有模型和 MCP 调用的总和。

`/traces/by-request/{requestId}` 返回一个单对象，字段与列表元素相同的核心子集：`traceId`、`requestId`、`eventType`、`routeId`、`modelId`、`mcpServiceId`、`statusCode`、`durationMs`、`observedAt`。

### 5.3 Trace Span 与属性

完整 Trace 为 OTLP JSON（Tempo `batches[].scopeSpans[].spans[]`），也兼容重建格式 `{ traceId, spans[] }`。常见父子关系：

```text
agent.run                         （外部平台可选导出）
└─ gen_ai.chat                    （外部平台可选导出）
   ├─ higress.gateway.request
   │  └─ higress.ai.model
   └─ mcp.tools.call              （外部平台可选导出）
      └─ higress.gateway.request
         └─ higress.mcp.call
```

允许稳定消费的属性如下：

| Span | 属性 |
|---|---|
| `higress.gateway.request` | `higress.request_id`、`higress.route_id`、`higress.upstream_cluster`、`higress.trace_origin`、`http.response.status_code` |
| `higress.ai.model` | 上述关联字段，`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.usage.reasoning_tokens`、`gen_ai.usage.cached_tokens`、`gen_ai.first_token_duration_ms` |
| `mcp.tools.call` | `mcp.service_id`、`mcp.tool_name`、`tool_call_id` |
| `higress.mcp.call` | `mcp.service`、`mcp.protocol`、`mcp.method`、HTTP/路由关联字段 |

属性仅为 allow-list。不要依赖未列出的 HTTP 头、请求体或内部存储字段。

### 5.4 成本汇总与筛选

```bash
curl --fail-with-body --silent --show-error \
  --user "$HIGRESS_CONSOLE_USERNAME:$HIGRESS_CONSOLE_PASSWORD" \
  "$HIGRESS_CONSOLE_URL/v1/observability/cost/summary?window=24h&route=ai-route-zhaozy.internal"
```

支持参数：

| 参数 | 可选值/格式 | 默认值 |
|---|---|---|
| `window` | `1h`、`24h`、`7d`、`30d` | `24h` |
| `route` | 精确路由 ID | 空（全部） |
| `provider` | 服务提供者实例标识 | 空（全部） |
| `model_instance` | 精确模型实例 ID | 空（全部） |

响应包含 `timeRange` 与 `selection`，调用方必须展示或记录其时间范围，不应自行假设为自然日：

```json
{
  "callCount": 6,
  "tokenTotal": 79130,
  "estimatedCost": "0",
  "averageFirstTokenMs": 171.5,
  "averageDurationMs": 4085.0,
  "serverErrors": 0,
  "timeRange": {
    "key": "24h",
    "label": "最近 24 小时",
    "startAt": "2026-08-23T02:10:00.000Z",
    "endAt": "2026-08-24T02:10:00.000Z"
  },
  "selection": {
    "route": "ai-route-zhaozy.internal",
    "provider": "",
    "modelInstance": ""
  },
  "resources": []
}
```

`tokenTotal` 为模型调用的 input、output、reasoning、cached Token 之和。`estimatedCost` 只表示已配置定价的模型调用估算，不能作为账单结算依据。

## 6. 时间口径

外部平台不要把不同层的时间相加来得到用户等待时间。应采用以下口径：

| 层级 | UI 展示口径 | 含义 |
|---|---|---|
| 智能体运行、LLM 对话 | 端到端最长 Span | 用户看到的编排总时间 |
| 网关请求覆盖 | 最长单请求，含其下游 | 最慢一次网关调用，不是累计 |
| 模型推理、MCP 工具调用、MCP 网关 | 实际耗时（同层 Span 时间并集）+ 累计耗时 | 前者去除并发/嵌套重叠，后者描述总工作量 |

例如一条 Trace 出现 `MCP 工具调用：实际 9.35s，累计 21.53s` 与 `MCP 网关：实际 9.23s，累计 22.17s` 是正常的：7 个工具调用包含 22 个可并行或嵌套的底层协议请求。累计值可大于端到端时间，不能用于 SLA。

若外部平台自己展示汇总，应从 Span 的 `startTimeUnixNano` 和 `endTimeUnixNano` 计算同名/同层 Span 的区间并集，不能只累加每个 Span 的时长。

## 7. 可选：上报外部平台自己的 Span

只透传 `traceparent` 已足以让网关 Span 使用相同 Trace ID；若希望在 Trace 中看到 Agent 编排层，还需导出自己的 OTLP Span。

受信网络内的标准环境变量：

```bash
export OTEL_SERVICE_NAME='order-assistant'
export OTEL_EXPORTER_OTLP_ENDPOINT='http://otel-collector:4318'
export OTEL_EXPORTER_OTLP_PROTOCOL='http/protobuf'
export OTEL_RESOURCE_ATTRIBUTES='deployment.environment=production'
```

本地 Compose 将 `4317`、`4318` 绑定在 `127.0.0.1`；容器内应用使用 `http://otel-collector:4318`。生产若允许跨网络 OTLP 导出，必须另行在入口层配置 TLS/mTLS、网络策略和属性脱敏，不能直接把本地 Collector 端口公开到互联网。

建议的 Span 名称与最小属性：

| Span 名称 | 必填/建议属性 |
|---|---|
| `agent.run` | `agent.platform`、`agent.application_id`、`agent.id`、`agent.run_id` |
| `gen_ai.chat` | `gen_ai.request.model`、`higress.route_id` |
| `mcp.tools.call` | `mcp.service_id`、`mcp.tool_name`、`tool_call_id` |

网关是 Token 和成本的唯一统计来源。外部平台不要写入 `gen_ai.usage.*`、`cost.*` 等会与网关事实重复计费的字段。

## 8. 错误处理与联调验收

| 场景 | HTTP/行为 | 适配器处理 |
|---|---|---|
| 未认证访问 Console | 401 | 检查 Basic 凭证或 Console Cookie；不降级直连 Collector |
| 无效 `requestId` / 不可见 Trace | 404 `trace_not_found` | 记录为不可见，不跨工作空间重试 |
| Tempo 查询无完整 Trace | 404 `tempo_trace_not_found` | 调用 `/traces/reconstructed/{traceId}` |
| 重建也无事实 | 404 `trace_fact_not_found` | 标记无可用历史数据 |
| Collector/Tempo 暂不可用 | 503 | 指数退避重试；不要丢失已保存的关联键 |
| 反查参数不合法 | 400 | 修正参数；`window` 只能取 §5.4 枚举 |

最小验收：

1. 发起一条带 `traceparent` 与三项 `X-Agent-*` 的 AI 路由调用；
2. 保存响应 `x-request-id` 与 `traceparent`；
3. 用 Console Basic 调 `/traces/by-request/{requestId}`，得到相同 `traceId`；
4. 调 `/traces/{traceId}`，确认至少有 `higress.gateway.request` 与 `higress.ai.model`；若平台已导出 Span，还应看到 `agent.run` 与 `gen_ai.chat`；
5. 发起一次 MCP 工具调用，确认 `mcp.tools.call → higress.gateway.request → higress.mcp.call`；
6. 调 `/cost/summary?window=1h`，确认 `timeRange`、调用次数和 Token 汇总随调用增长；
7. 确认所有 Span 与响应体中不出现 Prompt、工具参数、Authorization 或凭证。

## 9. 变更记录

### v1.1（2026-08-24）

- 以当前 Console、Collector 和 Trace 页面实现为准重写；
- 明确反查使用 Console Cookie / HTTP Basic Auth，移除未实现的 `trace.read` JWT 依赖；
- 补充 `/traces/search`、`/traces/authorize`、显式 `/traces/reconstructed` 及成本窗口/筛选参数；
- 更正 Tempo 不可用时由客户端显式降级的行为；
- 固化“实际耗时（去重覆盖）+ 累计耗时”的最新 Trace 时间口径；
- 明确 OTLP 仅在受信网络内用于 Span 导出，不是对外历史查询 API。
