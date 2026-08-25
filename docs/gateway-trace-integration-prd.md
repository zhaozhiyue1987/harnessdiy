# DeepSeek Harness × Higress Trace 对接 PRD

English | [中文](gateway-trace-integration-prd.zh.md)

- 版本：v1.7.0
- 状态：完整 Trace Provider 开发中
- 线上契约：[Higress Trace 链路与反查适配规范 v1.2](../../higress/docs/integration/trace-integration-and-reverse-query-guide-v1.2.md)
- Harness 最小接入：[Harness 接入 Higress Trace 反查指南 v1](../../higress/docs/integration/harness-higress-trace-adaptation-guide-v1.md)
- 关联决策：[Higress gateway trace integration](../.agents/notes/implemented/feature/2026-08-18-higress-gateway-trace.md)

## 1. 目标

Harness 为每次运行建立并上报本地 OpenTelemetry 调用树，通过 Higress 调用模型或 HTTP MCP 后异步取得已授权、已脱敏的网关 Trace 事实，并按请求关联挂到本地树。对接不上传 session、Trajectory、Prompt、消息、工具参数或 `gateway/trace` JSON；`X-Agent-*` 不参与鉴权，但受配置时每个网关请求必须携带。

最小反查关联键是每个 HTTP 响应独立保存的 `x-request-id` 与有效 `traceparent` 中的 trace-id；两者独立、任选其一可发起反查。反查不得阻塞 Agent 主轮次。

## 2. 新版方案与范围

v1.2 定义两个等价数据契约的历史反查入口。Harness 以 Gateway Trace Query 为默认生产方案，Console 仅供已受控持有 Console 管理凭据的部署选择。两种入口不得在一次查询中互相回退，避免权限模型和凭据混用。

| 方案 | 基址 | 鉴权 | 可用能力 | Harness 用途 |
| --- | --- | --- | --- | --- |
| Gateway Trace Query（默认） | `${gatewayBaseUrl}/__higress/trace-query/v1` | `Authorization: Bearer <trace-query-token>` | 精确 `by-request`、`traces`、`reconstructed`；账号 allow-list 过滤 | 自动阶段反查和运行详情 |
| Console（可选） | `${consoleBaseUrl}/v1/observability` | 服务端 HTTP Basic | 同上，另有 recent/search/authorize/cost summary | 已有 Console 管理账号的受控部署；成本浏览另行设计 |

浏览器、桌面客户端、Agent Prompt、模型工具和 session 日志不得持有 Trace Query Token、Console Basic 密码、Cookie、JWT、API Key 或内部工作空间信息。Harness 不得直连 Collector、Tempo、ClickHouse、Prometheus 或 OTLP 接收端。

## 3. 必须解决的问题

| 问题 | 需求 |
| --- | --- |
| 旧方案只支持 Console Basic | Service Provider 必须支持 Trace Query Bearer 服务账户；Console Basic 是独立可选 Provider，不是 Bearer 的回退。 |
| 并发 MCP 或流式协议存在多个 HTTP 响应 | 每个请求使用自己的异步收集器；工具结果保存关联集合，禁止模块级“最近响应”变量。 |
| 某些响应只返回一种关联头 | `x-request-id` 和 trace-id 分别持久化；仅 trace-id 时跳过 by-request，直接查询 Trace。 |
| Trace 数据最终一致 | 反查在后台以有限指数退避执行；只重试服务暂不可用的 503，不阻塞 Agent。 |
| Tempo 可能无完整 Trace | 只有 `404 tempo_trace_not_found` 才查询 reconstructed；其他 404 视为不存在或未授权。 |
| 服务账户返回的是经过授权过滤的 Span | 不把缺失父 Span、外部 Agent Span 或未授权并行分支视为错误；不得依赖 parentSpanId 完整性。 |
| 时间与成本容易被错误归属 | 本地实时用量、网关阶段事实、Console 聚合成本分开显示；不把嵌套/并行 Span 累计值当用户等待时间，也不把成本汇总写入某个 request。 |
| 网关返回的 `traceparent` 被误作下一请求的父上下文 | 响应 `traceparent` 仅作为反查关联证据保存；下一次请求只从 Harness 当前本地 Span 注入上下文。 |
| 旁路的标题、探测、重试或 SDK 内部调用丢失上下文 | 每次实际 HTTP 尝试必须经过统一的本地 Span 与请求头注入入口；无法观测的 SDK 自动重试必须关闭或迁移到 Harness 控制的重试。 |
| Tempo 中缺少 Harness 父 Span | 受信部署通过 OTLP HTTP/protobuf 导出本地 `agent.run`、模型和工具 Span；反查服务账户返回不含这些 Span 时，UI 仍使用本地树。 |
| Trajectory 把一次反查的全部 Span 平铺在本地请求详情中 | 以 `higress.gateway.request` 为一条真实网关请求记录，按安全的 Span ID 构建其可见子分支；点击该记录只展开此请求及其可达的网关 Span。 |

## 3.1 现有接入与完成目标

现有 Harness 代码为支持 `GenerateOptions.requestTrace` 的模型适配器注入 `traceparent` 和可选 `X-Agent-*` 头，也为 HTTP MCP transport 注入当前上下文并保存其响应关联。每个实际启用的模型适配器都必须实现这一约定；不能因 `dsh-llm-deepseek` 已实现而假定 `dsh-llm-pi-ai` 或其他适配器已具备相同行为。这只建立了出站关联的基础，不能单独证明某个运行 profile 已连接到 Higress、已完成后台反查或已向用户展示网关 Token。

完成后的运行必须同时满足以下条件：

1. 模型的实际 `baseURL` 是 Higress AI 路由，HTTP MCP 的实际 URL 是 Higress MCP 入口；stdio MCP 不属于网关链路，也不得显示为网关缺失。
2. profile 显式装载 `dsh-higress-trace`，并以受信服务端 `traceQueryBaseUrl` 与 `tokenRef` 启用一个 Provider。bundle 不得嵌入地址、Token 或 Console 凭据。
3. 每个模型或 HTTP MCP 响应以 `x-request-id`、有效 `traceparent` 中的 trace id，或两者同时作为独立关联记录。只有 trace id 的响应也必须触发后台反查。
4. 每个实际启用的 LLM 适配器都从 `GenerateOptions.requestTrace` 构造模型 HTTP 请求头，并在开始消费流体前从响应头生成一项 `trace-meta`。适配器不得通过模块级状态、SSE 末尾事件或猜测出站 trace id 代替响应关联。
5. 一个 Agent run 的模型、标题模型、HTTP MCP、探测和重试尝试使用同一 trace id。每次实际 HTTP 请求从当前 Harness 本地 client Span 注入其 `traceparent`；模型响应的 `traceparent` 绝不覆盖活动上下文。Harness 导出 `agent.run`、`gen_ai.chat`、`llm.client`、`mcp.tools.call` 和 `mcp.client`，使 MCP 成为本地工具 Span 的子节点而不是模型网关 Span 的子节点。
6. `traceQueryBaseUrl` 必须来自与实际 AI 路由和 MCP 入口同一 Higress 部署的 `traceIntegrationUrl`。业务调用使用数据面入口，反查可使用该部署的 `:4318` Trace 集成入口；两者端口不同不是错误。
7. Trajectory 展示授权返回的模型 Token、TTFT、Span 属性与数据来源；MCP Span 没有模型 Token 时明确显示未提供，不补零。

Gateway Trace Query 会按服务账户 allow-list 移除外部 Harness Span 和未授权父节点；界面不得把反查结果中的父节点缺失判定为链路失败，而应保留本地 Span 树。

## 3.2 运行配置需求

`dsh-higress-trace` 保持可选 bundle。部署的 Web profile 将该 bundle 放在 `dsh-base` 与 `dsh-web-app` 之后，并用 profile `cordis.patch.yml` 启用下列唯一 Provider：

```yaml
- replace:
    id: gateway-trace-query
    config:
      traceQueryBaseUrl: https://gateway.example.com/__higress/trace-query/v1
      tokenRef: HIGRESS_TRACE_QUERY_TOKEN
      reflect: true
      retry:
        maxAttempts: 4
        initialDelayMs: 250
        maxDelayMs: 2000
        maxConcurrentQueries: 4
```

`HIGRESS_TRACE_QUERY_TOKEN` 只由 Harness 服务端 credential Provider 解析。`traceQueryBaseUrl` 从 Higress `GET /system/gateway-public-url` 返回的 `traceIntegrationUrl` 派生，并固定追加 `/__higress/trace-query/v1`；不得用业务调用的 `:8080` 地址、Console 地址或 Collector 地址替代。Higress 服务账户 allow-list 必须包含实际 AI route，以及需要反查的 MCP service；否则精确反查以 404 表示不可见。运行前使用 `dsh --profile web --dump-config` 确认 Provider 已启用，再以不暴露 Token 的受信服务端探测确认反查入口属于同一部署；Token 不得出现在输出、session、浏览器配置或 Prompt 中。

本地 OTLP Provider 另行配置，不与 Trace Query Token 复用：`serviceName` 为 `harness`，`endpoint` 为同一 Higress 部署的 `traceIntegrationUrl` 加 `/v1/traces`，协议为 `http/protobuf`。`agentPlatform` 与非空 `agentApplicationId` 是部署配置；前者默认不得由请求 profile 覆盖，后者缺失时在加载阶段失败。详情见[本地 OTLP Span 设计](gateway-trace-otel-design.md)。

## 3.3 响应关联与后台反查设计

`GatewayResponseCorrelation` 保留 `responseTraceparent`、响应 trace id、可选 request id 与接收时间。响应 `traceparent` 仅证明网关的返回关联，绝不参与后续请求的父上下文选择；持久化反查继续只使用 request id 和 trace id。

`gateway/trace` 以 `turn`、`step` 和已解析的 trace id 锚定助手消息或工具结果。request id 存在时必须同时匹配；没有 request id 时，同一阶段的 trace id 是锚点。一个工具结果可保留多项关联；并发工具的收集器相互隔离。

`dsh-llm-pi-ai` 必须直接使用 `GenerateOptions.requestTrace`，而不是依赖只覆盖工具执行期的异步本地上下文。它将 `traceparent` 与存在的 `X-Agent-*` 写入 `Models.streamSimple()` 的请求 headers；部署 headers 可保留，但不能覆盖这些 Harness 所有的关联头。pi-ai 的 `onResponse` 回调在 HTTP 响应头到达时解析 `traceparent` 与 `x-request-id`，并让适配器在第一个模型内容分片前发出一项 `trace-meta`。该回调没有有效关联头时不发出 `trace-meta`，也不得由出站 `traceparent` 合成响应记录。

模型、标题模型和 MCP transport 都从其当前本地 Span 注入请求头。模型或工具响应没有关联头时，不影响本地父子树，只是缺少可反查的网关事实。HTTP MCP transport 按底层请求保留各自响应关联，stdio MCP 不经过 Higress，但仍可保留本地工具 Span。

反查以 `x-request-id` 优先，trace id 直查为等价路径。Provider 只在服务暂不可用的 `503` 重试；401、403、400、所有 404 和响应关联缺失不重试。只有 `tempo_trace_not_found` 才访问 reconstructed 端点。

## 3.4 Trajectory 网关事实展示

Gateway 面板按查询结果展示以下 allow-list 模型字段：

| 字段 | 展示规则 |
| --- | --- |
| `gen_ai.usage.input_tokens` | 有值时显示输入 Token |
| `gen_ai.usage.output_tokens` | 有值时显示输出 Token |
| `gen_ai.usage.reasoning_tokens` | 有值时显示推理 Token |
| `gen_ai.usage.cached_tokens` | 有值时显示缓存 Token |
| `gen_ai.first_token_duration_ms` | 有值时显示网关 TTFT |
| `mcp.service`、`mcp.protocol`、`mcp.method`、`mcp.tool.name` | 显示 MCP Span 的服务和方法，不显示模型 Token 占位值 |

网关 Token 与 Harness 本地流式 usage 并列标注数据来源，不相加、不互相覆盖。Gateway Trace Query 只返回授权 Span；面板必须显示 `tempo` 或 `reconstructed`，并允许空 Span 结果而不将其改写为零。

Trajectory 在会话存在网关观测时，默认先显示“网关请求”列表，再保留本地运行账本作为关联上下文。每条列表记录对应一个 `higress.gateway.request`，展示请求 ID、模型或 MCP 服务、请求时间、HTTP 状态、网关耗时和来源；相邻的 `higress.ai.model` 或 `higress.mcp.call` 是该条记录的可见子分支，不作为重复列表记录。列表按网关请求开始时间倒序排列，点击一条记录只渲染该请求及按 `parentSpanId` 可达的已授权 Span 分支，并显示其关联的本地 turn/step。缺少父 Span 仅表示授权范围限制，界面不得补造父节点、改写父子关系或把它标为失败。

反查输出新增安全的 `spanId`、可选 `parentSpanId` 和开始时间，用于本地索引、排序与分支选择；它们是 OTel 标识和时间元数据，不包含请求体、响应体、资源属性、事件、链接或凭据。客户端用纯函数从已持久化的 `gateway/trace` 事件派生记录，不发起网关请求、不持有凭据，也不等待全量 Trace 树后再渲染。网关明确标记为探测的记录可由“隐藏探测请求”过滤；缺少该标记时必须保留，不能以 Token、耗时、状态或路由猜测探测性质。

## 4. 出站与响应关联

LLM 和 HTTP MCP 的每次实际请求从当前本地 client Span 注入 W3C `traceparent`；`X-Agent-Run-Id`、`X-Agent-Platform`、`X-Agent-Application-Id` 由部署追踪配置写入，不参与鉴权。`X-Agent-Application-Id` 不得为空。stdio MCP 不经过 Higress，但不免除本地工具 Span。

响应头在开始消费流体前记录。关联对象至少包含 `responseTraceparent?`、`requestId?`、`traceId?`、`localSpanId`、`runId`、`receivedAt`；跨包、HTTP 和 Session 的 ID 使用 branded 类型。LLM 响应保留一项关联；一次工具调用保留其所有底层 HTTP 响应关联。关联记录仅保存在 Harness 本地，且不得成为模型可见消息。

`dsh-llm-pi-ai` 的通用流适配通过 pi-ai 的 `onResponse` 获取响应头，不为 OpenAI、pi-messages 或其他 API 分支各自复制 fetch 包装层。适配器在收到有效关联后把它作为 `trace-meta` 插入 Harness 流；原始响应头、请求体、响应体和调试元数据不进入 session。模型适配器和 HTTP MCP transport 使用同一关联解析规则，保证有效性判断、大小写和 branded ID 一致。

## 5. 能力缝与数据模型

实现阶段采用完整的 dsh 能力缝，而不是在 agent-loop 中直接写 HTTP：

| 角色 | 包 | 职责 |
| --- | --- | --- |
| Service Definition | `@deepseek-ai/dsh-telemetry` | 本地 Span 生命周期、W3C 注入、OTLP 导出接口与异步上下文隔离 |
| Service Provider | `@deepseek-ai/dsh-telemetry-otel` | OTLP HTTP/protobuf 导出、本地运行与 client Span 配置 |
| Consumer | `@deepseek-ai/dsh-agent-loop`、LLM adapters、HTTP MCP transport、标题模型 | 创建语义 Span，并为每次实际出站请求注入当前 client Span |
| Service Definition | `@deepseek-ai/dsh-gateway-trace` | branded 响应关联 ID、带安全 Span 标识的 `GatewayTraceObservation`、log-only session 事件与查询服务接口 |
| Service Provider A | `@deepseek-ai/dsh-gateway-trace-query` | Trace Query Bearer 服务账户、allow-list 结果解析、后台反查 |
| Service Provider B | `@deepseek-ai/dsh-gateway-trace-console` | 可选 Console Basic 反查；不被默认 bundle 启用 |
| Consumer | `@deepseek-ai/dsh-client-ui-trajectory` | 关联结果与本地轨迹并列展示 |

`GatewayTraceService.query(correlation)` 接收最小关联对象，返回 `GatewayTraceObservation | undefined`。查询规则如下：

```text
有 x-request-id：GET /by-request/{requestId} → traceId
仅有 trace-id：直接使用 traceId
traceId：GET /traces/{traceId}
  └─ 仅 404 tempo_trace_not_found：GET /traces/reconstructed/{traceId}
```

观测值包含关联 ID、入口来源、`tempo | reconstructed` 数据质量标记、请求索引字段、可展示的 allow-list Span 属性、Span 标识、父 Span 标识和时间指标。仅解析规范允许的网关、模型与 MCP 属性；过滤资源属性、事件、链接、请求/响应体和所有凭据。MCP Span 没有模型 Token 时保持缺失，不填零。

`gateway/trace` 是 `SessionEventMap` 的 `ignorable: true`、log-only 扩展，不进入派生模型消息、不改变 `SESSION_FORMAT_VERSION`。它由 request id（存在时）或 trace id 锚定到已有的 `assistant/message` 或 `tool/result`；已提供的关联键必须与反查结果一致。反查失败不追加事件。

## 6. Provider 配置与安全要求

配置采用显式互斥模式，并在 `resolve()` 中完成默认值与验证：

```yaml
gateway-trace-query:
  mode: gateway-direct
  traceQueryBaseUrl: https://gateway.example.com/__higress/trace-query/v1
  tokenRef: HIGRESS_TRACE_QUERY_TOKEN
  reflection:
    maxAttempts: 4
    initialDelayMs: 250
    maxDelayMs: 2000
    maxConcurrentQueries: 4
```

```yaml
gateway-trace-console:
  mode: console
  consoleBaseUrl: https://console.example.com
  basicUsernameRef: HIGRESS_CONSOLE_USERNAME
  basicPasswordRef: HIGRESS_CONSOLE_PASSWORD
  reflection:
    maxAttempts: 4
    initialDelayMs: 250
    maxDelayMs: 2000
    maxConcurrentQueries: 4
```

所有凭据均通过 `CredentialRef` 在受信服务端解析，绝不写入 YAML、日志、错误、Span 或 session。缺少凭据返回无数据并只产生安全诊断；无效 URL、单边 Basic 引用、同时装载两个 Provider 等自包含配置错误在加载时失败。Provider 卸载时取消队列、计时器和未开始请求。

## 7. 时间、成本和 UI

Trajectory 在网关观测可用时优先以真实网关请求为入口，按 request id 或 trace id 回链到本地 `agent.run` 树，并明确入口和 `reconstructed` 标记。缺少网关数据时回退本地轨迹；本地轨迹、实时 Token 和会话重放不受影响。网关请求索引是 `dsh-client-ui-trajectory` 内的纯 Consumer 逻辑，不改变 gateway Provider、主循环、Session 格式或浏览器网络权限，并在选中前不构造未选记录的分支详情。

时间展示遵循 v1.2：Agent 运行和 LLM 对话使用端到端最长 Span；网关请求使用最长单请求；同层模型或 MCP 同时展示区间并集的实际耗时与累计工作量。UI 不把并行或嵌套 Span 相加为用户等待时间。

`/cost/summary` 只属于 Console 工作空间聚合，不属于自动阶段反查，也不可由 Gateway Trace Query 枚举。若后续实现，必须单独的显式用户操作、持久化 `window`、筛选条件、`timeRange` 与 `selection`，且绝不写成单 request、turn 或 session 成本。

## 8. 实现范围与验收

开发和交付遵循 Harness 社区 dsh 插件规范及根目录 `AGENTS.md`：完整 Service Definition/Provider/Consumer、ESM 与显式 tsconfig、Config Schema、`ctx.effect()`/`ctx.on()` disposer、`./invariant`、双语 README、Agent Note、bundle 组合测试和最小相关检查。可安装 bundle 只装载一个 Provider，端点和凭据均由部署配置提供。

后续实现必须证明：

1. `x-request-id` 优先与仅 trace-id 直查均可工作；独立响应头和并发 MCP 关联不串写。
2. Gateway Trace Query Bearer 与 Console Basic 都只在各自 Provider 使用，且默认 bundle 选择前者。
3. OTLP `batches[].scopeSpans[].spans[]`、reconstructed 格式、allow-list 过滤和 `tempo_trace_not_found` 回退符合规范。
4. 401、400 和所有 404 不盲目重试；503 遵守有限退避及并发上限。
5. invariant 在 live append、seed、fork、resume、reload 中拒绝无锚点或 trace-id 冲突的观测。
6. `dsh-llm-pi-ai` 的 OpenAI-compatible 路由与 pi-messages 路由、标题模型、探测和 Harness 控制的重试都从当前本地 Span 透传 `requestTrace`；响应回调在第一个内容分片前产生一项关联，且 deployment header 不能覆盖 Harness 关联头。
7. 在一次“2 次模型 + 1 次 HTTP MCP”运行中，所有网关请求使用同一 trace id、没有 `gateway_created`、都有非空 `X-Agent-Application-Id`，Tempo 含 `agent.run`、`gen_ai.chat`、`mcp.tools.call`，且 MCP 网关 Span 的父节点是 Harness 工具/client Span。
8. 网关请求列表只列出真实 `higress.gateway.request`，每条记录按 request ID 展开自身的已授权 Span 分支；模型与 MCP 记录可区分，缺失父节点不被伪造，已明确标识的探测请求可独立隐藏。
9. 纯索引在客户端对观测输入线性处理，详情按选中记录延迟生成；浏览器不新增反查、OTLP 或鉴权网络请求，其他 dsh bundle 不依赖该 UI Consumer。
8. 可运行示例快照覆盖 Tempo、reconstructed、无数据、并发工具、标题模型、SDK 重试和多 MCP 响应；交付前按 `dsh-pre-push-checks` 选择检查并运行 docs 同步、类型、测试和 diff 检查。

## 9. 不在本期范围

- 客户端直连任一反查入口或分发反查凭据；
- 直连 Higress 内部存储和 Collector；
- 向浏览器、session、Prompt 或 Trace Query 服务账户暴露 OTLP 凭据；
- Console 的 recent、search、authorize 和成本枚举 UI；
- 伪造逐请求成本、完整父子树或跨 allow-list 的 Trace 数据。

## 10. 完整 Trace 查询 Provider（本期新增）

Gateway Trace Query 只能返回经过服务账户 allow-list 过滤的 Higress Span，无法满足 Trajectory 展示 `agent.run`、`gen_ai.chat`、`mcp.tools.call` 和 `mcp.client` 的需求。本期增加独立的 `@deepseek-ai/dsh-gateway-trace-console` Provider，通过受信服务端 Console Observability API 查询完整 Trace；它不修改 `gateway-trace-query` 的 Bearer Provider，也不让浏览器直接访问 Console。

完整 Trace Provider 使用 `consoleBaseUrl`、`basicUsernameRef` 和 `basicPasswordRef` 三个显式配置项。两个 credential 引用必须由服务端 credentials Provider 解析，Basic Authorization 只在 Host 请求中构造，不进入 Session、OTLP Span、错误文本或 Client bundle。缺少任一配置、URL 非绝对 HTTP(S) 或只配置单边 credential 时在插件加载阶段失败。

该 Provider 复用 `GatewayTraceService` 的最小 `query(correlation)` 能力和同一套响应关联、503 退避、`tempo_trace_not_found` 到 `reconstructed` 回退及 Span allow-list；Console 成功返回的外部 Harness Span 仅保留语义名称、Span ID、父 Span ID、时间、状态和已批准的 `gen_ai.*`、`mcp.*` 字段。它不暴露资源属性、事件、链接、请求正文、响应正文、工具参数或成本聚合。

部署通过 `dsh-higress-trace` 的 profile patch 选择一个 Provider：需要完整跨平台树时启用 `gateway-trace-console`，仅需 Higress 授权事实时启用 `gateway-trace-query`，两个 Provider 不能同时挂载。UI Consumer 不变，继续从 `gateway/trace` 事件读取完整 Span；当 Console 查询失败时保留本地轨迹并显示数据来源和失败状态，不把受限网关结果伪装成完整树。

完整 Trace 验收新增以下条件：一次包含两次模型调用和一次 HTTP MCP 工具调用的运行中，`/traces/{traceId}` 至少返回 `agent.run`、`gen_ai.chat`、`mcp.tools.call`、`mcp.client`、`higress.gateway.request` 和 `higress.mcp.call`；MCP 网关请求的父链能沿 Span ID 回到 `mcp.tools.call`，页面显示 Run ID、Agent Platform、Application ID，并且浏览器网络面板看不到 Console 凭据。
