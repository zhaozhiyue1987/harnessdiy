# Agent Note: MCP 客户端对失效远端会话的自动恢复

Status: implemented

[English](2026-08-18-mcp-session-expiry-auto-recovery.md) | 中文

## 问题

会话被网关过期的 Streamable HTTP MCP 服务器，在有人重新绑定之前会永久不可用。在 ModelScope 12306 网关上有实际观测：服务端超时后，每次 `tools/call` 都返回 `Code: SessionExpired`，描述同一个死掉的 `mcp-session-id`，并且在对话剩余部分反复出现。

[自动重连监督器](../feature/2026-08-06-mcp-client-auto-reconnect.md)按设计无法恢复这种情况。SDK 的 `StreamableHTTPClientTransport` 在传输的整个生命周期内持有同一个会话 ID 并在每次请求中复用；它只对"有意的关闭"触发 `onclose`，服务器的拒绝以逐请求错误的形式暴露。由于传输关闭是唯一的重连触发条件，监督器正确地认为连接仍然健康，从不协商新会话。被拒绝的调用以不透明的 `Error POSTing to endpoint … SessionExpired` 呈现给模型，唯一的出路是在 MCP 界面重新绑定服务器——这会挂载全新的 mcp-client fiber 并重新协商。

## 决策

工具桥接在链路边界对一种狭窄且可证明的失败进行分类，并将其路由进既有的监督器路径。当 `tools/call` 的拒绝标明远端会话已失效时，执行器触发 `ToolBridgeOptions` 上的 `onSessionInvalid` 回调，并重新抛出原始错误；监督器随后关闭当前 generation，其 onclose 驱动本就幂等的重连循环，由全新传输协商出新会话 ID。模型仍然看到原始的调用错误——恢复发生在该轮调用背后，代价是一个退避间隔，而不是继续复用死掉的会话。

分类器对字符串化的 `cause` 链（SDK 会把网关的 JSON-RPC 负载包进一句英文说明，可能还把原始错误嵌套在 `cause` 下）匹配一个刻意保持简短的标记清单：Streamable HTTP 规范的会话故障词汇（`MCP-Server-Session-Not-Valid`、非法的 `mcp-session-id` 头）以及观测到的 ModelScope 负载（`SessionExpired`、"session … is expired"）。匹配刻意收窄：一般的逐请求失败绝不能拆除仍健康的连接——原 note 的否决对其仍然成立。

本条部分取代了 auto-reconnect note 中被否决的"将 Streamable HTTP 请求失败路由到监督器"方案。harness 仍然不能、也不会把任意请求失败当作服务器死亡；唯一的例外是会话失效这一类，此时重新协商是明确必要的。

## 备选方案

- **将任意 Streamable HTTP 请求失败路由进监督器。** 旧 note 的否决依然成立：逐请求失败并不意味着服务器已死，为临时故障付出 generation 更替与一个退避间隔毫无收益。
- **在传输内部重新初始化。** SDK 持有会话 ID，且没有 harness 能可靠驱动的重新协商钩子；generation 拆除直接复用监督器经过测试的 close→onclose→reconnect 路径。
- **只让模型请用户重新绑定。** 那就是手动变通方案本身，不产生任何恢复，还依赖模型配合——作为人工兜底可以，作为恢复机制不行。

## 后果

- 会话过期的 Streamable HTTP 服务器在一个退避间隔（默认首次延迟 500 ms）后自动恢复。失败的那一轮仍然报错；下一轮即可成功。
- 对其他所有失败类别，HTTP 服务器仍不进入监督器重启范围（依原 note）；这是唯一记录在案的例外。
- `ToolBridgeOptions` 增加了可选的 `onSessionInvalid` 回调（默认无）——桥接与监督器之间的内部契约，不是用户配置。

## 测试

`packages/mcp/mcp-client/tests/mcp-client.spec.ts` 中的单元测试用 mock 的 `callTool` 拒绝来钉住分类器两侧：观测到的 ModelScope `SessionExpired` 负载恰好触发一次 `onSessionInvalid`，同时调用结果仍为 `isError`；而普通的上游失败不会触发。监督器侧的接线（close→onclose→reconnect）就是 `reconnect.spec.ts` 已覆盖的传输关闭路径。无快照：该改动不新增任何模型可见的呈现，失败调用在恢复前后仍追踪同样的错误文本。