# @deepseek-ai/dsh-client-ui-mcp

[English](README.md) | 中文

Web 客户端的 MCP 管理 UI：一个承载服务器目录的 settings 段，以及一个针对当前会话绑定和解绑 MCP 服务器的对话停靠区。两个界面仅通过生成的 `mcpManager` remote 契约与宿主通信。

## 用法

浏览器半侧 [client 插件](../../client/AGENTS.md)；将其加入 web bundle 后，`dsh-client-ui-mcp` 通过 slot 系统注入其区块。无配置键；`dsh.client` 声明 `platform: web`。

## Slots

| Slot | id | order |
|---|---|---|
| `settings.section` | `mcp` | 40 |
| `conversation.input.dock` | `mcp` | 30 |

settings 段承载目录（list/upsert/delete），对话停靠区针对目录中的服务器绑定和解绑当前会话；每个已绑定服务器的 chip 可展开查看端点详情与实时工具清单。

## 消费的服务

| 服务 | 用途 |
|---|---|
| `ctx.slots` | 注入 settings 段与对话输入停靠区 |
| `remote.mcpManager` | 目录与会话绑定／解绑 RPC |
| `remote` | 限定会话的 RPC 目标解析 |
| `locale` | 停靠区与段文案 |

状态在 `connection/reset` 时重新同步；目录控制器与每个会话一个的控制器投射宿主的 `list()` 与 `bound()` 结果。

## 模型体验

间接地，经由宿主 `mcp-manager` 及它挂载的 mcp-client 绑定，停靠区绑定成功时其桥接层注册模型可见的工具。

#### KV 缓存影响

UI 本身不追加任何模型上下文；只有宿主挂载 mcp-client 实例后，绑定才会进入会话请求前缀。

## 已知限制与延后工作

- **仅浏览器端**——此插件运行在 web GUI 半侧；ACP 与 headless 界面改经 `mcpManager` RPC 契约管理服务器。
- **停靠区只呈现宿主的实时清单**——断连或未连接的服务器由持久化目录展示，但其会话工具状态反映 `bound()` 的报告内容。
- **工具数刷新依赖 MCP 端点可用**——settings 段会为每次刷新建立一次连接并调用 `tools/list`；传输或业务失败会通过操作提示显示，不会写入旧的工具数。
