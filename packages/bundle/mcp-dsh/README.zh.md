# `@deepseek-ai/dsh-mcp`

[English](README.md) | 中文

dsh MCP 捆绑包。[`cordis.patch.yml`](cordis.patch.yml) 在插件树中插入托管 MCP 服务器目录（`mcp-manager`），在 [`dsh-base`](../base/README.md) 之上启用持久化服务器配置和会话级绑定/解绑。作为 profile 层使用：`dsh --profile headless,mcp`。

web-app 捆绑包已直接挂载 `mcp-manager`；本层适用于需要 MCP 服务器管理但不包含完整浏览器界面的 headless 和自定义 profile。

## 模型体验

间接影响，通过插入的配置行：本捆绑包插入 mcp-manager，管理器的 mcp-client 桥接拥有面向模型的工具注册。

#### KV 缓存影响

无；本捆绑包不向请求前缀贡献任何内容。

## 已知限制与延期工作

- **无浏览器界面** — 管理 UI（设置区段、输入停靠栏）位于 `dsh-client-ui-mcp`，仅在 web-app profile 中组合。Headless 消费者通过 Typert Remote API 或直接编辑 `settings.yaml` 管理目录。
