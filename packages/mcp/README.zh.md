# mcp/ — MCP 能力系列

[English](README.md) | 中文

将 harness 与模型上下文协议生态桥接：`mcp-client` 连接外部 MCP 服务器并将其工具暴露给模型；`mcp-manager` 维护持久服务器目录并通过 Typert Remote 将会话与服务器绑定。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`mcp-client/`](mcp-client/README.md) | 每个实例连接一个 MCP 服务器，并将其工具注册到 `ctx.tools` | 注册到 `ctx.tools` |
| [`mcp-manager/`](mcp-manager/README.md) | 作为 Typert Remote 服务的持久服务器目录、限定会话的绑定／解绑与工具清单 | `ctx.mcpManager` |

浏览器端管理 UI（`dsh-client-ui-mcp`）位于 [`client/`](../client/README.md) 组，仅通过 remote 契约消费 `mcp-manager`。

跨 wire 契约——`McpServerSpec`、`McpManagerResult<T>`、错误码、绑定语义——在 `mcp-manager/src/types.ts` 中一次定义，并镜像到两个生成半侧（`typert.host`、`typert.remote-client`）。