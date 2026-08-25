# Agent Note: Pi-AI gateway trace correlation

Status: implemented

English | [中文](2026-08-24-pi-ai-gateway-trace-correlation.zh.md)

## Problem

The active `llm-pi-ai` route can send model traffic through Higress without consuming `GenerateOptions.requestTrace` or retaining the response correlation. HTTP MCP requests then have a step trace context but not the returned model Span context, so gateway data cannot establish the intended model-to-MCP parent-child link or reliably anchor model Token observations.

## Decision

`dsh-llm-pi-ai` consumes `GenerateOptions.requestTrace` when it is present. It writes W3C `traceparent` and optional `X-Agent-*` fields into the pi-ai request headers after profile headers, so deployment configuration cannot suppress or replace Harness correlation headers.

The adapter uses pi-ai's common `onResponse` callback to parse the HTTP response headers before stream content is consumed. It emits one `trace-meta` chunk before the first model-content chunk only when the response supplies a valid `traceparent` or non-empty `x-request-id`. It never derives a response correlation from the outbound context, stream payload, or shared mutable state.

The agent loop uses a returned model `traceparent` as the parent context for subsequent HTTP MCP requests. Without it, model and MCP calls remain trace-id peers and Trajectory labels the relationship as same-Trace-only. This extends the active integration described by [Higress gateway trace integration](../feature/2026-08-18-higress-gateway-trace.md).

## Alternatives considered

- **Wrap global fetch in the agent loop.** pi-ai owns its HTTP clients and a global wrapper would capture unrelated traffic while missing adapters that use another transport.
- **Generate model `trace-meta` from the outbound traceparent.** A request header does not prove that Higress accepted, recorded, or assigned a response correlation.
- **Keep only HTTP MCP propagation.** It can group calls by a locally generated trace id but cannot establish the returned model Span as the MCP parent.

## Consequences

The pi-ai OpenAI-compatible and pi-messages paths share the same request-header and response-correlation behavior. A valid response correlation becomes one `trace-meta` before content, while absent or invalid headers leave no fabricated correlation. Focused adapter, agent-loop, and MCP transport tests pin the propagation and same-Trace-only behavior.

Higress may omit response correlation headers. Harness retains trace-id aggregation in that case but cannot represent a verified model-to-MCP parent-child link. A Trace Query account outside the AI/MCP deployment or allow-list likewise yields no authorized facts; the application reports absence without disclosing credentials or attempting cross-resource enumeration.
