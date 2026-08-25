# Agent Note: MCP dock geometry and bound-server detail panel

Status: implemented

English | [中文](2026-08-18-mcp-dock-detail-and-alignment.zh.md)

## Problem

The per-session MCP dock (bind/unbind chips) used its own ad-hoc `.dock` layout, so the strip spanned the full composer-stack width and its content started at the stack's left edge — 16px outside the input card under the shared composer variables (`--dsh-composer-side-clearance`, `--dsh-composer-dock-inset`). Users read this as chips floating far left of the conversation box. Separately, a bound server had no in-UI way to inspect what it actually connects to or exposes: no endpoint detail, no tool inventory. And the SSE transport option was invisible in the settings section, although the option (`form.transport.sse`) existed in source — the running web app served a stale `lib/client.js` bundle that predated it.

## Decision

`McpDock.module.css` adopts the shared composer dock geometry already used by QueueDock: the strip subtracts `side-clearance × 2 + dock-inset × 2` from the full stack width, is capped at `card-max-width − dock-inset × 2`, centers itself, and completes the inset with horizontal padding — so chip content starts exactly at the input card's edge.

The bound-server chip's name/count summary becomes a toggle button (`aria-expanded`, `aria-controls`) that expands a panel below the strip: a meta line (transport with URL or command, from the catalog spec) and the live tool inventory (`McpBoundServer.tools`, already projected onto the session view) — each tool shows its raw name and description, with an explicit empty state when a server exposes no tools. Three new zh/en locale pairs cover the labels.

The SSE option needed no source change: `McpSettingsSection` already listed all three transports. Rebuilding the ui-mcp client bundle and refreshing the page served it (`/plugins/*/client.js` revalidates with `cache-control: no-cache`).

## Alternatives considered

**Put the detail in the settings section instead of the dock.** Rejected: the tool inventory is per-bound-session and already arrives on the session view; the dock is where users notice a bound server. Settings keeps list/upsert/delete.

**A full tool table with input schemas.** Rejected for now: the inventory names and descriptions answer the visible gap; schemas are one click from the user guide and keep the panel compact.

## Testing

Live web-app verification: dock container bounds (855–1619) sit inside the input card bounds (848–1626) with the 8px inset on both sides and an 8px gap above the card; the settings transport select now lists 流式 HTTP / SSE（旧版事件流）/ stdio（本地命令）; binding a server renders the chip, expanding it shows `streamable-http · <url>` and 8 named tools with descriptions, the empty state is a separate branch. `oxlint` and `tsc` pass on the package; `verify-translation-pairing` records 940 consistent pairs; `doc-sync` passes 28/28. The package has no unit tests.

## Consequences

Chips sit directly above the conversation box and aligned to it; any bound server can be inspected for its endpoint and tools in place; a rebuilt bundle exposes the SSE transport option again.