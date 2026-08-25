# @deepseek-ai/dsh-client-ui-mcp

English | [中文](README.zh.md)

MCP management UI for the web client: a settings section for the server catalog and a per-session dock that binds and unbinds MCP servers for the active conversation. Both surfaces talk to the host only through the generated `mcpManager` remote contract.

## Usage

Browser-half [client plugin](../../client/AGENTS.md); add it to a web bundle and `dsh-client-ui-mcp` injects its sections through the slots system. No configuration keys; `dsh.client` declares `platform: web`.

## Slots

| Slot | id | order |
|---|---|---|
| `settings.section` | `mcp` | 40 |
| `conversation.input.dock` | `mcp` | 30 |

The settings section hosts the catalog (list/upsert/delete), and the conversation dock binds and unbinds the active session on the catalog servers; each bound-server chip expands to the endpoint detail and the live tool inventory.

## Services consumed

| Service | Usage |
|---|---|
| `ctx.slots` | Injects the settings section and the conversation input dock |
| `remote.mcpManager` | Catalog and session bind/unbind RPCs |
| `remote` | Session-scoped RPC target resolution |
| `locale` | Dock and section strings |

State re-syncs on `connection/reset`, and the catalog controller plus one per-session controller project the host's `list()` and `bound()` results.

## Model Experience

Indirectly, through the host `mcp-manager` and the mcp-client bindings it mounts, whose bridge registers the model-visible tools when a dock bind succeeds.

#### KV Cache effect

The UI appends no model context itself; a bind only enters the session request prefix once the host mounts the mcp-client instance.

## Known Limitations and Deferred Work

- **Browser-only** — this plugin runs in the web GUI half; the ACP and headless surfaces manage servers through the `mcpManager` RPC contract instead.
- **The dock renders the host's live inventory only** — a disconnected or unconnected server is shown from the persisted catalog, but its session tool state reflects whatever `bound()` reports.
- **Tool-count refresh depends on the MCP endpoint** — the settings section opens a connection and calls `tools/list` for each refresh; transport or business failures appear through the operation notice and never overwrite the prior tool count.
