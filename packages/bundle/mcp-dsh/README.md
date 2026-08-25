# `@deepseek-ai/dsh-mcp`

English | [中文](README.zh.md)

The dsh MCP bundle. [`cordis.patch.yml`](cordis.patch.yml) inserts the managed MCP server catalog (`mcp-manager`) into the plugin tree, enabling persistent server configuration and session-scoped bind/unbind over [`dsh-base`](../base/README.md). Apply it as a profile layer: `dsh --profile headless,mcp`.

The web-app bundle already mounts `mcp-manager` directly; this layer is for headless and custom profiles that need MCP server management without the full browser surface.

## Model Experience

Indirectly, through the inserted rows: this bundle inserts mcp-manager, and the manager's mcp-client bridges own the model-visible tool registrations.

#### KV Cache effect

None; the bundle contributes nothing to the request prefix.

## Known Limitations and Deferred Work

- **No browser surface** — the management UI (settings section, input dock) lives in `dsh-client-ui-mcp`, which is only composed in the web-app profile. Headless consumers manage the catalog through the Typert Remote API or `settings.yaml` directly.
