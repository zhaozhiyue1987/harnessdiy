# @deepseek-ai/dsh-mcp-manager

English | [中文](README.zh.md)

MCP management surface: owns a persistent server catalog (a settings section), exposes it plus session-scoped bind/unbind and live tool inventory over Typert Remote, and realizes each binding as an mcp-client instance mounted on the target agent's scoped context — so tools land in that session's layer only and a bind survives exactly as long as the agent does.

## Usage

Host-side plugin; add it to a bundle's host half and the catalog becomes a `mcpManager` settings section:

```yaml
- id: mcp-manager
  name: '@deepseek-ai/dsh-mcp-manager'
```

The browser half (`dsh-client-ui-mcp`) and any Typert Remote client use `ctx.mcpManager` through the generated `./remote` client only.

## Remote API

| Method | Request | Result |
|---|---|---|
| `list` | — | The persisted catalog, defaults resolved |
| `upsert` | server spec | The persisted (default-filled) spec; an existing `serverName` is replaced (edit) |
| `deleteServer` | `serverName` | Removes the server and unbinds it from every session; `unknown-server` when absent |
| `bound` | — (agent from session) | The session's bound servers with their live tool inventory |
| `bind` | `serverName` | Mounts an mcp-client instance on the agent scope and returns the new binding; `unknown-server`, `already-bound`, or `bind-failed` |
| `unbind` | `serverName` | Disposes the binding; `not-bound` when absent |

Results carry an `ok`/`error` discriminant (`McpManagerResult<T>`); failures use codes such as `invalid-spec`, `unknown-server`, `already-bound`, `bind-failed`, `not-bound`, `settings-unavailable`, and `internal`. The wire contract is authored once in `src/types.ts` and mirrored into both generated halves (`./typert` host, `./remote` client).

## Bound instance lifecycle

Each binding mounts `mcp-client` under a derived name `base_<sha256(session:server)>`, so tool names are deterministic per session and a re-bound server on a restored session reproduces the same instance. Bindings hang off the agent scope: agent teardown disposes them, and `agent/disposed` drops the bookkeeping entry. `deleteServer` unbinds everywhere before touching the catalog, and concurrent catalog writes serialize on an internal mutation tail.

## Services provided

| Service | Notes |
|---|---|
| `ctx.mcpManager` | Typert Remote service (`McpManagerService`) |

## Services consumed

| Service | Usage |
|---|---|
| `ctx.settings` | Persists the `mcp-manager` catalog section |

## Model Experience

Indirectly, through the mcp-client bindings the manager mounts on each agent scope, whose bridge registers the model-visible tools and schemas.

#### KV Cache effect

A bind introduces the discovered tool schemas into that session's request prefix; rebinding or unbinding changes the prefix at the bind point, while an unchanged binding stays prefix-stable.

## Known Limitations and Deferred Work

- **Tools are the only bridged MCP capability** — MCP Resources and Prompts have no harness consumer, and the catalog exists for tool-exporting servers only.
- **The manager depends on the concrete mcp-client plugin** rather than a Service Definition, so swapping the client transport or adding an alternate provider requires touching the manager.
- **No connection or discovery timeout is exposed** — bind awaits the mcp-client startup path with its SDK-inherited defaults.
- **The catalog is plain user settings** — hot-reloaded from disk like every settings section and not scoped per workspace or per session.