# Agent Note: Higress one-way OTLP tracing

Status: implemented

English | [中文](2026-08-26-higress-one-way-otlp-tracing.zh.md)

## Problem

Harness must send coherent Agent, model, and MCP trace context to Higress while keeping the Harness runtime independent of Higress query APIs, Console credentials, and response payloads.

## Decision

`dsh-telemetry` and `dsh-telemetry-otel` own local semantic spans and OTLP export. Each Agent driver execution creates an `agent.run` root span with a unique run id. It contains `gen_ai.chat`, `llm.client`, `mcp.tools.call`, and `mcp.client` spans. Model and HTTP MCP requests inject the active client span's W3C `traceparent` plus the configured `X-Agent-Run-Id`, `X-Agent-Platform`, and `X-Agent-Application-Id` headers.

The runtime does not read or persist response `traceparent` or request-id headers. It does not include a gateway-trace service, trace-query or Console provider, reverse-query bundle, gateway session event, or Trajectory gateway view. Higress receives OTLP data at its configured endpoint and remains the only trace-query surface.

## Alternatives considered

- **W3C propagation without local export.** Rejected because Higress would receive spans whose Harness parents do not exist in the backend.
- **Gateway Trace Query or Console reverse query.** Rejected because this deployment requires no data return path and would require query credentials, session records, and UI code.
- **Using a gateway response span as a later parent.** Rejected because it is a completed remote span rather than the local model or tool operation that starts the next request.

## Consequences

- A deployment needs only an OTLP endpoint and non-secret platform and application identifiers for tracing.
- MCP management remains separate: `dsh-mcp-manager`, `dsh-mcp-client`, and the MCP bundle manage configured MCP servers and calls.
- Trace investigation happens in Higress or its configured backend; Harness has no per-request trace lookup UI.

## Verification

- Focused tests prove W3C header injection and local Agent, model, and MCP span nesting.
- The source tree contains no gateway-trace package, reverse-query configuration, response-correlation stream chunk, or gateway trace session event.
