# @deepseek-ai/dsh-mcp-manager

[English](README.md) | 中文

MCP 管理面：拥有持久服务器目录（settings 段），通过 Typert Remote 暴露目录及限定会话的绑定／解绑与实时工具清单，并将每个绑定实现为挂载在目标 agent 作用域上下文上的 mcp-client 实例——因此工具只落进该会话的层，绑定存续时间与 agent 完全一致。

## 用法

宿主侧插件；将其加入 bundle 的 host 半侧后，目录即成为 `mcpManager` settings 段：

```yaml
- id: mcp-manager
  name: '@deepseek-ai/dsh-mcp-manager'
```

浏览器半侧（`dsh-client-ui-mcp`）与任何 Typert Remote 客户端仅通过生成的 `./remote` 客户端使用 `ctx.mcpManager`。

## Remote API

| 方法 | 请求 | 结果 |
|---|---|---|
| `list` | — | 持久化目录，默认值已解析 |
| `upsert` | 服务器规格 | 持久化的（默认值已填充）规格；已存在的 `serverName` 被替换（编辑） |
| `deleteServer` | `serverName` | 移除服务器并解绑其所有会话绑定；不存在时返回 `unknown-server` |
| `bound` | —（由会话解析 agent） | 该会话已绑定的服务器及其实时工具清单 |
| `bind` | `serverName` | 在 agent 作用域上挂载 mcp-client 实例并返回新绑定；`unknown-server`、`already-bound` 或 `bind-failed` |
| `unbind` | `serverName` | 释放绑定；不存在时返回 `not-bound` |

结果携带 `ok`／`error` 判别字段（`McpManagerResult<T>`）；失败使用诸如 `invalid-spec`、`unknown-server`、`already-bound`、`bind-failed`、`not-bound`、`settings-unavailable` 与 `internal` 等错误码。wire 契约在 `src/types.ts` 中一次定义，并镜像到两个生成半侧（`./typert` host、`./remote` client）。

## 绑定实例生命周期

每个绑定以派生名 `base_<sha256(session:server)>` 挂载 `mcp-client`，因此工具名按会话确定性生成，恢复的会话上重新绑定会重建相同实例。绑定挂在 agent 作用域上：agent 释放即销毁绑定，`agent/disposed` 清理簿记条目。`deleteServer` 先解绑所有会话再改动目录；并发的目录写入经内部变更队列串行化。

## 提供的服务

| 服务 | 说明 |
|---|---|
| `ctx.mcpManager` | Typert Remote 服务（`McpManagerService`） |

## 消费的服务

| 服务 | 用途 |
|---|---|
| `ctx.settings` | 持久化 `mcp-manager` 目录段 |

## 模型体验

间接地，经由管理器挂载到各 agent 作用域上的 mcp-client 绑定，其桥接层注册模型可见的工具与 schema。

#### KV 缓存影响

绑定将该会话发现到的工具 schema 引入请求前缀；重新绑定或解绑会改变绑定点的前缀，而未变的绑定保持前缀稳定。

## 已知限制与延后工作

- **工具是唯一桥接的 MCP 能力**——MCP Resources 与 Prompts 没有 harness 消费方，目录仅为导出工具的服务器而存在。
- **管理器依赖具体的 mcp-client 插件**而非 Service Definition，因此更换客户端传输或添加替代提供方需要改动管理器。
- **未暴露连接或发现超时**——bind 继承 mcp-client 启动路径上 SDK 的默认超时。
- **目录是普通用户设置**——与其他 settings 段一样从磁盘热加载，不按 workspace 或会话划分作用域。