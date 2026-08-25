# 使用 MCP 插件

[English](mcp.md) | 中文

本指南假设你已经按照[根 README](../../../README.md#run)启动 Web UI 并挂载了 MCP 插件，并且通过[模型配置指南](./providers.md)接好了模型路由。它覆盖把外部[模型上下文协议](https://modelcontextprotocol.io/)（Model Context Protocol，MCP）服务器接入 harness 的两种方式：在 `cordis.yml` 中静态装配固定配置，以及从 Web UI 动态管理、按会话控制。

## MCP 集成提供什么

MCP 能力把 harness 桥接到 MCP 生态。每个已连接的 MCP 服务器都会把它的工具作为原生工具暴露给模型，名称带有服务器限定前缀：`mcp__<serverName>__<toolName>`——与 Claude Code、Codex 使用的形态一致。支持三种传输方式：

- `stdio`——派生本地命令（例如 `npx -y @modelcontextprotocol/server-foo`），通过标准输入输出与 MCP 服务器通信。
- `streamable-http`——连接现代 HTTP 的 MCP 端点。
- `sse`——连接只发布 Server-Sent Events 的旧版服务器。部分公开 MCP 服务依然只支持这种传输。

Web UI 在**设置 → MCP 服务**下提供服务器目录，在输入框下方提供按会话使用的工具坞（dock）。整个能力由 mcp 插件族提供：[`mcp-manager`](../../../packages/mcp/mcp-manager/README.md) 持有目录与会话绑定，[`mcp-client`](../../../packages/mcp/mcp-client/README.md) 为每个服务器运行一条连接，[`dsh-client-ui-mcp`](../../../packages/client/ui-mcp/README.md) 渲染两个面板。

## 启用 MCP 插件

把三个插件加入你的组合的 `cordis.yml`。`mcp-manager` 在 host 半区，`dsh-client-ui-mcp` 在浏览器半区并通过 slots 系统注入面板，`mcp-client` 必须可装载，因为管理器会为每个绑定挂载一个实例：

```yaml
- id: mcp-manager
  name: '@deepseek-ai/dsh-mcp-manager'
- id: mcp-client
  name: '@deepseek-ai/dsh-mcp-client'
- id: ui-mcp
  name: '@deepseek-ai/dsh-client-ui-mcp'
```

`mcp-manager` 注册一个 `mcpManager` 设置段，因此目录就是普通的用户设置：它持久化在 `$DSH_HOME/settings.yaml` 中，并像其他设置段一样随磁盘热重载。

## 从 Web UI 添加服务器

打开**设置 → MCP 服务**。该段列出所有已配置的服务器，并提供一个添加表单。

填写名称并选择传输方式：

- 选择 **stdio（本地命令）**时，给出命令（例如 `npx`）和用空格分隔的参数（例如 `-y @modelcontextprotocol/server-everything`）。
- 选择 **流式 HTTP** 或 **SSE（旧版事件流）**时，给出服务器 URL：streamable-http 服务用 `https://mcp.api-inference.modelscope.net/<id>/mcp`，纯 SSE 端点（没有 `/mcp` POST 路由）用 `https://mcp.api-inference.modelscope.net/<id>/sse`。

名称会成为工具命名空间，必须匹配 `[A-Za-z0-9_-]{1,32}`，并且在所有已配置的服务器中唯一。点击**添加服务器**。目录会保存你的条目并显示在列表中；**移除**会删除服务器并解除它在所有会话中的绑定。

鉴权头等高级字段不在表单里；请按[配置鉴权头与高级设置](#configure-headers-and-advanced-settings)中的方式在 `settings.yaml` 中编辑。

## 把服务器绑定到会话

在输入框下方，**MCP 工具**坞列出当前会话已绑定的服务器及其实时工具。点击目录条目旁的**绑定**，把该服务器挂载到当前会话；之后模型就能看到该服务器的工具，名称为 `mcp__<serverName>__<toolName>`。**解除绑定**会断开连接并从会话移除这些工具。

绑定是会话级的：它们挂在 agent 作用域上，因此会话结束即释放；在恢复的会话上创建的绑定会复现同一个确定性的实例。绑定在成功前会等待连接与工具发现完成；失败的绑定会显示管理器的失败原因。

## 配置鉴权头与高级设置

<a id="configure-headers-and-advanced-settings"></a>

持久化的目录位于 `$DSH_HOME/settings.yaml` 的 `mcp-manager` 段下。省略任何可选字段时，都会回退到 mcp-client 的默认值。一个进阶条目长这样：

```yaml
mcp-manager:
  servers:
    - serverName: bazi
      transport: sse
      url: https://mcp.example.com/bazi/sse
      headers:
        Authorization: Bearer <token>
      toolCallTimeoutMs: 60000
      failOnStartupError: false
      reconnect:
        enabled: true
        initialDelayMs: 500
        maxDelayMs: 30000
        maxAttempts: 10
```

每个被管理服务器字段的含义：

| 字段 | 传输方式 | 默认值 | 含义 |
|---|---|---|---|
| `toolCallTimeoutMs` | 任意 | `60000` | 每次 `callTool` 调用的超时。 |
| `failOnStartupError` | 任意 | `false` | 初始连接或发现失败时，拒绝绑定而不是无工具地绑定成功。 |
| `reconnect.enabled` | 任意 | `true` | 连接丢失后自动重连。 |
| `reconnect.initialDelayMs` | 任意 | `500` | 首次重连延迟；每次失败后翻倍。 |
| `reconnect.maxDelayMs` | 任意 | `30000` | 退避上限；同时也是重置尝试预算的在线上限时间。 |
| `reconnect.maxAttempts` | 任意 | `10` | 每次故障期内连续失败次数的上限，超过后取消注册该服务器的工具。 |
| `headers` | streamable-http、sse | — | 请求头，例如 `Authorization`，同时作用于两个请求方向。 |
| `env` | stdio | — | 派生命令的额外环境变量。 |

完整的插件配置目录列出每个字段与默认值：[config-catalog](../../config-catalog.md)。

## 与模型协作

绑定的工具以服务器提供的描述与输入 schema 出现在会话中，名称形如 `mcp__<serverName>__<toolName>`。使用相同原始工具名的不同服务器会在各自命名空间下共存。重连会重新发现并整体替换工具集合，因此故障后工具既不会重复也不会泄漏；耗尽重连预算的服务器会取消注册其工具，直到重新绑定。

## 故障排查

- **工具坞里始终看不到该服务器**——检查目录条目与服务端实际传输是否匹配。纯 SSE 端点（没有 `/mcp` POST 路由）只能用 `sse`；streamable-http 端点只能选**流式 HTTP**。
- **绑定提示 `already-bound`**——该服务器已经挂载到本会话；请先解除绑定。
- **绑定时启动失败**——设置 `failOnStartupError: true`，把记录在日志中的失败变成显式的绑定错误；并确认 URL 可达、鉴权头被接受。
- **`invalid-spec`**——HTTP 或 SSE 传输缺少 URL 字段，或名称不匹配 `[A-Za-z0-9_-]{1,32}`。
- **故障后工具不再响应**——HTTP 服务器按调用重试；崩溃的 stdio 子进程或关闭的 SSE 流会走重连策略（`reconnect.*`），其预算最终会放弃并取消注册工具。若调用失败证明远端会话已失效（`SessionExpired` 等），同样会触发该策略，由重连协商全新会话 ID。

## 参考

- [mcp-client 插件](../../../packages/mcp/mcp-client/README.md)——每条连接的契约：工具命名、行为、重连与限制。
- [mcp-manager 插件](../../../packages/mcp/mcp-manager/README.md)——目录持久化、Remote API 与绑定生命周期。
- [dsh-client-ui-mcp 插件](../../../packages/client/ui-mcp/README.md)——设置段与会话坞。
- [配置目录](../../config-catalog.md)——所有受支持的字段与默认值。