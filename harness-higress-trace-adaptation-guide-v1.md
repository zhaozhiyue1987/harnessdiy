# Harness 接入 Higress Trace 反查指南 v1

> 适用对象：Harness 服务端适配器。本文只描述 Harness 需要实现的最小对接，不要求 Harness 改变自身 Trajectory、会话或工具调用数据结构。
>
> 推荐方式：Gateway Trace Query 服务账户。Console 反查仅作为已有 Higress Console 管理账号时的备选方案。

## 1. 接入目标

Harness 通过 Higress 调用模型或 MCP 后，将一次 Harness 运行中的某个响应与 Higress 的网关 Trace 关联，并在后台补充可展示的、已脱敏的网关事实。

最小关联键只有两个：

| 响应头 | 用途 |
|---|---|
| `x-request-id` | 首选精确反查键 |
| `traceparent` | 从第二段提取 32 位 `traceId`，用于查询 Span 明细 |

`X-Agent-Run-Id`、`X-Agent-Platform` 和 `X-Agent-Application-Id` 可选；它们有助于 Console 中关联展示，但**不是**调用或反查的前置条件。

Harness 不需要向 Higress 上传完整的 run、消息、工具参数或 `gateway/trace` 事件。请只在 Harness 本地保存上述响应关联键。

## 2. 推荐配置：Gateway Trace Query

Higress 管理员会为 Harness 创建独立的 Trace Query 服务账户，并限定可查询的网关消费者、路由或 MCP 服务。Harness 只需要得到明文 Token；Higress 端只保存其 SHA-256 哈希。

```bash
HIGRESS_GATEWAY_URL=https://gateway.example.com
HIGRESS_TRACE_QUERY_TOKEN=<由密钥管理系统注入>
```

查询基址：

```text
${HIGRESS_GATEWAY_URL}/__higress/trace-query/v1
```

该 Token：

- 仅保存在 Harness 服务端或密钥管理系统；
- 不可下发给浏览器、桌面端、Agent Prompt 或模型工具；
- 不可替代调用模型/MCP 所需的 API Key；
- 不可使用 Console Basic 密码或 `OBSERVABILITY_INTERNAL_TOKEN` 代替。

## 3. 调用时注入和保存关联键

### 3.1 发起模型/MCP 请求

建议 Harness 为每个当前执行上下文生成或继承 W3C `traceparent`：

```http
traceparent: 00-<32 位 trace-id>-<16 位当前 span-id>-01
X-Agent-Run-Id: <harness-run-id>                  # 可选
X-Agent-Platform: harness                         # 可选
X-Agent-Application-Id: <application-id>          # 可选
```

Higress 会保留有效的 trace ID；未传 `traceparent` 不会阻止业务调用，但 Harness 难以将多次网关调用收敛到同一外部 Trace。

### 3.2 每个 HTTP 响应独立保存

在收到响应头时立即保存关联记录；流式响应也必须在读取流结束前保存，不能只依赖最后一个 SSE 事件。

```json
{
  "harnessRunId": "run_01J...",
  "gatewayRequestId": "7beb0d4f-6b8d-4311-9519-66197e861056",
  "traceparent": "00-82251b76899f93dcd6169c15a2044267-f8f683422af6460a-01",
  "traceId": "82251b76899f93dcd6169c15a2044267",
  "receivedAt": "2026-08-24T03:20:00.000Z"
}
```

并发模型调用和并发工具调用必须使用每个请求自己的异步上下文收集器。不要使用模块级“最新响应”变量，否则同一工具的多个 HTTP 响应会互相覆盖。

## 4. 后台反查流程

反查是最终一致的后台工作，不应阻塞 Harness Agent 主轮次。推荐在 250 ms、500 ms、1 s、2 s 后做有限重试；只重试 404/503 等尚未可见或暂不可用的情况。

```text
x-request-id
  └─ GET /by-request/{requestId}
      └─ traceId
          └─ GET /traces/{traceId}
              ├─ 200：使用经账号范围过滤后的 Gateway Span
              └─ 404 tempo_trace_not_found
                   └─ GET /traces/reconstructed/{traceId}
```

如果没有 `x-request-id`、但有有效 `traceparent`，可跳过第一步，直接从 `traceparent.split('-')[1]` 取 `traceId` 查询。

### 4.1 TypeScript 示例

```ts
type GatewayCorrelation = {
  gatewayRequestId?: string;
  traceId?: string;
};

const queryBase = `${process.env.HIGRESS_GATEWAY_URL}/__higress/trace-query/v1`;
const token = process.env.HIGRESS_TRACE_QUERY_TOKEN!;

async function gatewayGet(path: string) {
  const response = await fetch(`${queryBase}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

export async function queryGatewayTrace(correlation: GatewayCorrelation) {
  let traceId = correlation.traceId;
  if (correlation.gatewayRequestId) {
    const indexed = await gatewayGet(
      `/by-request/${encodeURIComponent(correlation.gatewayRequestId)}`,
    );
    if (indexed.status === 200) traceId = indexed.payload.traceId;
    if (indexed.status === 401 || indexed.status === 403) return { state: 'unauthorized' };
  }
  if (!traceId) return { state: 'not-linked' };

  const complete = await gatewayGet(`/traces/${encodeURIComponent(traceId)}`);
  if (complete.status === 200) return { state: 'tempo', traceId, payload: complete.payload };
  if (complete.status !== 404) return { state: 'pending-or-unavailable', traceId };

  const reconstructed = await gatewayGet(`/traces/reconstructed/${encodeURIComponent(traceId)}`);
  if (reconstructed.status === 200) return { state: 'reconstructed', traceId, payload: reconstructed.payload };
  return { state: 'not-found', traceId };
}
```

## 5. API 契约

所有请求都必须带：

```http
Authorization: Bearer <HIGRESS_TRACE_QUERY_TOKEN>
```

| 方法 | 路径 | 成功响应 |
|---|---|---|
| GET | `/by-request/{requestId}` | 紧凑请求索引，包含 `traceId`、路由、模型/MCP、状态、耗时和观测时间 |
| GET | `/traces/{traceId}` | Tempo 格式 `batches[].scopeSpans[].spans[]`，但仅包含该服务账户已授权的 Higress Span 和属性白名单 |
| GET | `/traces/reconstructed/{traceId}` | `{ traceId, spans, reconstructed: true }`；由保留的网关审计事实重建 |

方式 B 不提供以下接口：`recent`、`search`、`authorize`、`cost/summary`。这些接口会造成全量历史枚举，只能通过 Console 的工作空间权限使用。

完整 Trace 的 Gateway 直连结果可能出现“父 Span 不在当前结果中”。这是预期安全行为：外部 Agent Span、未授权并行分支、Tempo 资源属性、事件和链接会被移除。不要将缺失父 Span 当作链路失败。

允许稳定消费的属性仅包括：

- `higress.request_id`、`higress.route_id`、`higress.upstream_cluster`、`higress.trace_origin`；
- `http.request.method`、`http.response.status_code`、`higress.outcome`；
- 模型：`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.usage.*`、`gen_ai.first_token_duration_ms`；
- MCP：`mcp.service`、`mcp.protocol`、`mcp.method`、`mcp.tool.name`。

## 6. 错误处理

| 状态 | 含义 | Harness 行为 |
|---|---|---|
| 200 | 找到数据 | 追加或更新 Harness 自己的只读网关观测记录 |
| 400 | `requestId` 或 `traceId` 格式错误 | 标记关联键无效，不重试 |
| 401 | Token 缺失、无效或已撤销 | 告警服务端凭证配置，不把 Token 返回给用户 |
| 404 `trace_not_found` | 不存在或不在服务账户允许范围 | 视为不可见；不要尝试其他路由/消费者枚举 |
| 404 `tempo_trace_not_found` | Tempo 完整 Trace 暂无或已过期 | 调用 `/traces/reconstructed/{traceId}` |
| 404 `trace_fact_not_found` | 审计事实也不存在 | 标记无可用历史数据 |
| 503 | Collector/Tempo 暂不可用 | 按有限指数退避重试 |

## 7. 数据边界

Higress Trace Query 不接收、也不会返回以下内容：Prompt、消息正文、模型响应正文、工具参数、工具结果、Cookie、`Authorization`、API Key、JWT 或内部工作空间 ID。

Harness 应把网关异步观测结果与自身的实时 Token/成本/轨迹数据分开显示。网关的模型/MCP 时间可能彼此并发或嵌套；不要把分类累计耗时相加后当作用户端到端等待时间。

## 8. Console 备选方式

如果 Harness 所属服务已经受控地持有 Console Basic 凭证，可使用：

```text
https://<console-host>:8001/v1/observability
```

其查询顺序相同，但路径为 `/traces/by-request/{requestId}`、`/traces/{traceId}`、`/traces/reconstructed/{traceId}`。Console Basic 权限等同管理能力，优先使用本指南的 Gateway Trace Query 服务账户方案。

更完整的 Higress 接入、OTLP 导出、时间口径和服务账户运维见 [Trace 链路与反查适配规范 v1.2](trace-integration-and-reverse-query-guide-v1.2.md)。
