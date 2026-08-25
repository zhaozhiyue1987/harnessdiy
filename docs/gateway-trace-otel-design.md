# Harness 本地 OTLP Trace 与 Higress 关联设计

English | [中文](gateway-trace-otel-design.zh.md)

## 1. 目的与边界

本设计让 Harness 自己拥有完整调用树，并通过 W3C `traceparent` 将每个实际模型或 HTTP MCP 请求连接到 Higress。Higress 响应中的 `x-request-id` 和 `traceparent` 是网关事实的反查键，不是 Harness 后续调用的父上下文。

Gateway Trace Query 服务账户只能返回授权的 Higress Span。Trajectory 因此以 Harness 本地树为主，以 request id 或 trace id 将网关 Token、TTFT 和 MCP 属性挂到对应本地 client Span；不得期待受限反查结果返回 Harness Span 或完整跨平台父节点。

## 2. 目标调用树

```text
agent.run
├─ gen_ai.chat
│  └─ llm.client (each actual model HTTP attempt)
│     └─ higress.gateway.request → higress.ai.model
├─ mcp.tools.call
│  └─ mcp.client (each actual MCP HTTP attempt)
│     └─ higress.gateway.request → higress.mcp.call
└─ gen_ai.chat (title, probe, or background model call; retains its purpose)
   └─ llm.client
```

每个 Run 创建一个 `agent.run` 根 Span 和 trace id。每次模型逻辑调用创建 `gen_ai.chat`，每次工具逻辑调用创建 `mcp.tools.call`；每个底层 HTTP 尝试创建独立 client Span。并发工具和流式 MCP 的每项底层请求拥有独立异步上下文，不能共享“最近响应”或 Span 状态。

## 3. DSH 插件拆分

| 角色 | 建议包 | 职责 |
| --- | --- | --- |
| Service Definition | `@deepseek-ai/dsh-telemetry` | 创建/结束本地 Span，获取当前上下文，生成出站 HTTP 头，记录安全属性与响应关联键。 |
| Service Provider | `@deepseek-ai/dsh-telemetry-otel` | 用 OTLP HTTP/protobuf 批量导出已结束 Span；在卸载时 flush 或取消队列。 |
| Consumers | agent-loop、LLM runtime/adapters、MCP HTTP transport、session-title LLM | 在语义边界创建 Span，并在每次实际 HTTP 尝试前取得 client 子 Span。 |
| Existing Service | `@deepseek-ai/dsh-gateway-trace` | 保留反查与脱敏展示；以本地 Span identity 和响应关联键定位节点，不管理父子上下文。 |

Service Definition 维护 `AsyncLocalStorage` 中的不可变 `TraceExecutionContext`：run id、trace id、当前 local Span id、平台和应用标识。创建子 Span 时复制上下文；结束后恢复外层上下文。响应关联对象只保存 `responseTraceparent`、request id、trace id、local Span id、run id 和接收时间。

## 4. 出站规则

每个实际 HTTP 尝试从当前 local client Span 注入：

```http
traceparent: 00-<run-trace-id>-<local-client-span-id>-01
X-Agent-Run-Id: <run-id>
X-Agent-Platform: harness
X-Agent-Application-Id: <configured-application-id>
```

模型适配器必须在读取流前保存响应关联。MCP transport 对初始化、GET、POST、SSE 和 streamable HTTP 的每次请求重复该规则。标题模型不再直接构造无追踪 `GenerateOptions`；它接收调用发起者的本地上下文或创建一个带 session/run 归属的本地根上下文。

第三方 SDK 的自动重试必须能为每次实际请求暴露一个可注入的 fetch/attempt hook。不能满足该条件时，关闭 SDK 自动重试并转由 Harness 的可观测重试策略执行；模型探测和预检同样走统一入口。

## 5. OTLP 与配置

```yaml
- id: telemetry-otel
  disabled: false
  config:
    serviceName: harness
    endpoint: http://<gateway-host>:4318
    agentPlatform: harness
    agentApplicationId: <deployment-application-id>
```

endpoint 来自与业务网关、Trace Query 同一 Higress 部署的 `traceIntegrationUrl`。Provider 使用固定的 OTLP HTTP/protobuf 协议并自动追加 `/v1/traces`；也接受已带该路径的 endpoint。该配置、Trace Query Token 与业务调用 API Key 分属不同用途；OTLP 导出不使用 Trace Query 服务账户。无效 endpoint 或空 `agentApplicationId` 在加载时失败。Span 属性只包含语义名称、耗时、状态和关联键；禁止写入 Prompt、消息、工具参数、Cookie、认证头或凭据。

## 6. 持久化、反查与 UI

本次交付将本地 Span 直接导出到 OTLP，不向 Session 追加本地 Span 摘要。Session 继续只保存用于网关反查的 `GatewayResponseCorrelation`，且它对模型不可见。Trace Query 的受限响应继续只显示网关 Span；需要查看跨平台完整树时，使用受控 Tempo/Console Trace 查询。反查失败不会改变本地 Span 生命周期。

Gateway Trace Provider 在现有脱敏属性之外保留 `spanId`、可选 `parentSpanId` 与开始时间；这些 OTel 元数据仅用于本地排序和构造已授权分支。`higress.gateway.request` 是网关列表的一条记录根，其可达 `higress.ai.model` 或 `higress.mcp.call` 后代属于同一记录。无可见父节点的 Span 保持独立可见，不嫁接到其他网关请求，也不宣称本地 Harness 父子关系。

`dsh-client-ui-trajectory` 是唯一的展示 Consumer。它以纯函数从已装配的 `gateway/trace` 观测生成轻量请求索引：先渲染按开始时间排序的真实网关请求，用户点击后才按 Span ID 构建该记录的分支详情。模型与 MCP 类型只由已授权 Span 名称和 allow-list 属性判定；探测过滤只接受网关明确的事件标识，未知记录默认展示。该 Consumer 不调用网关、Tempo 或 OTLP，不获取凭据，不改变 Session 格式，也不向主循环新增依赖，因此可随 UI bundle 独立装载和卸载。

Trajectory 同时保留本地 Span 树、每个节点的本地状态与允许的网关事实。服务账户过滤导致父 Span 缺失时，显示“网关事实受授权范围限制”，不把网关 Span 拼接成伪造的本地父子树。

## 7. 验证

使用一次“2 次模型调用 + 1 次 HTTP MCP 工具调用”验收：全部请求同一 trace id、没有 `gateway_created`、都有相同 run id 和非空 application id；Tempo 包含本地 `agent.run`、`gen_ai.chat` 与 `mcp.tools.call`；MCP 网关 Span 的父节点来自本地工具/client Span。Trajectory 首屏按真实网关请求显示模型与 MCP 记录，点击任一请求只展开其已授权分支，且不新增浏览器网络请求。另覆盖标题模型、并发工具、流式协议、探测、重试、OTLP 导出失败和 Trace Query 过滤。

## 8. 完整 Trace Provider

`@deepseek-ai/dsh-gateway-trace-console` 是独立的 Host Provider。它通过 Console Observability API 查询完整 Trace，并实现 `GatewayTraceService`，因此现有反查事件、Trajectory Consumer 和客户端凭据边界无需改变。Console Provider 使用 HTTP Basic；`@deepseek-ai/dsh-gateway-trace-query` 继续使用 Gateway Bearer Token，两个 Provider 不互相回退，也不得同时加载。

完整 Trace Provider 的配置只接受 `consoleBaseUrl`、`basicUsernameRef`、`basicPasswordRef` 和既有有界重试字段。Host 在解析 credential 引用后构造 Basic Authorization，每次查询结束立即丢弃 header。请求路径沿用 `/v1/observability/traces/by-request/{requestId}`、`/traces/{traceId}` 和显式 `/traces/reconstructed/{traceId}`；只有 `tempo_trace_not_found` 触发重建查询。响应仍经过 `normalizeGatewayTrace` 的 allow-list，外部 Harness Span 的语义名称和父子 ID因此可进入 `gateway/trace`，Prompt、工具参数、资源属性和凭据不会进入 Session。

Profile bundle 只启用一个 Provider。完整树部署示例：

```yaml
- id: gateway-trace-console
  name: '@deepseek-ai/dsh-gateway-trace-console'
  config:
    consoleBaseUrl: https://console.example.com
    basicUsernameRef: HIGRESS_CONSOLE_USERNAME
    basicPasswordRef: HIGRESS_CONSOLE_PASSWORD
```
