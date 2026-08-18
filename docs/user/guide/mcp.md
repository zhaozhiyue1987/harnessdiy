# Use MCP servers

English | [中文](mcp.zh.md)

This guide assumes you started the Web UI through the [root README](../../../README.md#run) with the MCP plugins mounted, and connected the model route through the [model configuration guide](./providers.md). It covers both ways to bring external [Model Context Protocol](https://modelcontextprotocol.io/) servers into the harness: static wiring in `cordis.yml` for a fixed setup, and dynamic management from the Web UI for per-session control.

## What MCP integration gives you

The MCP capability bridges the harness to the Model Context Protocol ecosystem. Each connected MCP server exposes its tools to the model as native tools under a server-qualified name, `mcp__<serverName>__<toolName>` — the same shape Claude Code and Codex use. Three transports are supported:

- `stdio` — spawn a local command (e.g. `npx -y @modelcontextprotocol/server-foo`) and speak MCP over its stdin/stdout.
- `streamable-http` — connect to a modern HTTP MCP endpoint.
- `sse` — connect to a legacy server that only publishes Server-Sent Events. Some public MCP hubs still ship this transport only.

The browser UI adds a server catalog under **Settings → MCP 服务** and a per-session tool dock under the composer. The whole surface is provided by the mcp plugin family: [`mcp-manager`](../../../packages/mcp/mcp-manager/README.md) owns the catalog and session bindings, [`mcp-client`](../../../packages/mcp/mcp-client/README.md) runs one connection per server, and [`dsh-client-ui-mcp`](../../../packages/client/ui-mcp/README.md) renders both panels.

## Enable the MCP plugins

Add the three plugins to your composition's `cordis.yml`. `mcp-manager` is host-side, `dsh-client-ui-mcp` is browser-side and injects its panels through the slots system, and `mcp-client` must be loadable because the manager mounts one instance per binding:

```yaml
- id: mcp-manager
  name: '@deepseek-ai/dsh-mcp-manager'
- id: mcp-client
  name: '@deepseek-ai/dsh-mcp-client'
- id: ui-mcp
  name: '@deepseek-ai/dsh-client-ui-mcp'
```

`mcp-manager` registers a `mcpManager` settings section, so the catalog is ordinary user settings: it persists in `$DSH_HOME/settings.yaml` and hot-reloads from disk like every other section.

## Add a server from the Web UI

Open **Settings → MCP 服务**. The section lists every configured server and a form to add one.

Enter a name and pick a transport:

- For **stdio (本地命令)**, give the command (e.g. `npx`) and its space-separated arguments (e.g. `-y @modelcontextprotocol/server-everything`).
- For **流式 HTTP** or **SSE（旧版事件流）**, give the server URL: `https://mcp.api-inference.modelscope.net/<id>/mcp` for a streamable-http server, and `https://mcp.api-inference.modelscope.net/<id>/sse` for a pure-SSE endpoint (no `/mcp` POST route).

The name becomes the tool namespace and must match `[A-Za-z0-9_-]{1,32}` and be unique across configured servers. Click **添加服务器**. The catalog stores your entry and shows it in the list; **移除** deletes a server and unbinds it from every session.

Headers and other advanced fields are not part of the form; edit them in `settings.yaml` as shown in [Configure headers and advanced settings](#configure-headers-and-advanced-settings).

## Bind servers to a session

Below the composer, the **MCP 工具** dock lists the session's bound servers with their live tools. Click **绑定** next to a catalog server to mount it on the current session; the model then sees that server's tools as `mcp__<serverName>__<toolName>`. **解除绑定** disposes the connection and removes the tools from the session.

Bindings are session-scoped: they hang off the agent scope, so ending the session disposes them, and a binding created on a restored session reproduces the same deterministic instance. A bind awaits connection and tool discovery before it reports success; a failed bind shows the manager's failure reason.

## Configure headers and advanced settings

The persisted catalog lives under the `mcp-manager` section of `$DSH_HOME/settings.yaml`. Every optional field falls back to an mcp-client default when omitted. An advanced entry looks like:

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

Field meaning, per managed server:

| Field | Transport | Default | Meaning |
|---|---|---|---|
| `toolCallTimeoutMs` | any | `60000` | Timeout per `callTool` invocation. |
| `failOnStartupError` | any | `false` | A failed initial connection or discovery rejects the bind instead of binding with no tools. |
| `reconnect.enabled` | any | `true` | Reconnect automatically after a lost connection. |
| `reconnect.initialDelayMs` | any | `500` | First reconnect delay; doubles per failed attempt. |
| `reconnect.maxDelayMs` | any | `30000` | Backoff ceiling; also the uptime that resets the attempt budget. |
| `reconnect.maxAttempts` | any | `10` | Consecutive failures per outage before the server's tools are unregistered. |
| `headers` | streamable-http, sse | — | Request headers such as `Authorization`, attached to both request directions. |
| `env` | stdio | — | Extra environment variables for the spawned command. |

The full plugin configuration catalog lists every field and default: [config-catalog](../../config-catalog.md).

## Work with the model

Bound tools appear in the session with the server-provided description and input schema, named `mcp__<serverName>__<toolName>`. Distinct servers publishing the same raw tool name coexist under their namespaces. Reconnects re-discover and replace the tool set, so tools neither duplicate nor leak after an outage; a server that exhausts the reconnect budget has its tools unregistered until it is re-bound.

## Troubleshooting

- **The server never appears in the tool dock** — Check the catalog entry matches the server's actual transport. A pure-SSE endpoint (no `/mcp` POST route) works only with `sse`; a streamable-http endpoint only with 流式 HTTP.
- **绑定 reports `already-bound`** — The server is already mounted on this session; unbind first.
- **Binding fails on startup** — Set `failOnStartupError: true` to turn the logged failure into an explicit bind error, and confirm the URL is reachable and the headers are accepted.
- **`invalid-spec`** — The URL field is missing for an HTTP or SSE transport, or the name does not match `[A-Za-z0-9_-]{1,32}`.
- **Tools stop answering after an outage** — An HTTP server is retried per call; a crashed stdio child or a closed SSE stream goes through the reconnect policy (`reconnect.*`), whose budget eventually gives up and unregisters the tools.

## References

- [mcp-client plugin](../../../packages/mcp/mcp-client/README.md) — per-server connection contract: tool naming, behavior, reconnect, and limitations.
- [mcp-manager plugin](../../../packages/mcp/mcp-manager/README.md) — catalog persistence, Remote API, and binding lifecycle.
- [dsh-client-ui-mcp plugin](../../../packages/client/ui-mcp/README.md) — the settings section and conversation dock.
- [Config catalog](../../config-catalog.md) — every supported field and default.