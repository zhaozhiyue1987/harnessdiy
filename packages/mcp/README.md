# mcp/ — MCP capability family

English | [中文](README.zh.md)

Bridges the harness to the Model Context Protocol ecosystem: `mcp-client` connects external MCP servers and exposes their tools to the model; `mcp-manager` keeps a persistent server catalog and binds servers to sessions over Typert Remote.

| Package | Role | ctx key |
|---|---|---|
| [`mcp-client/`](mcp-client/README.md) | Connects one MCP server per instance and registers its tools on `ctx.tools` | registers on `ctx.tools` |
| [`mcp-manager/`](mcp-manager/README.md) | Persistent server catalog, session-scoped bind/unbind, and tool inventory as a Typert Remote service | `ctx.mcpManager` |

The browser-side management UI (`dsh-client-ui-mcp`) lives in the [`client/`](../client/README.md) group and consumes `mcp-manager` only through the remote contract.

The cross-wire contract — `McpServerSpec`, `McpManagerResult<T>`, error codes, bind semantics — is authored once in `mcp-manager/src/types.ts` and mirrored in both generated halves (`typert.host`, `typert.remote-client`).