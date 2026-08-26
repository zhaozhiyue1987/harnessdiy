/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL; SSE connects to a legacy
 * HTTP+SSE endpoint.
 *
 * HTTP-based transports (Streamable HTTP, SSE) receive a `fetch` wrapper that
 * reads the active W3C Trace Context from `@deepseek-ai/dsh-llm`'s
 * `AsyncLocalStorage` and injects `traceparent` + `X-Agent-*` headers. When
 * no trace context is active (e.g. standalone MCP use outside the agent loop)
 * no trace headers are added.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { getTraceContext, traceContextHeaders } from '@deepseek-ai/dsh-llm'
import type { TraceTelemetry } from '@deepseek-ai/dsh-telemetry'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Wrap `globalThis.fetch` to inject W3C Trace Context headers from the active
 * `AsyncLocalStorage` trace context. When no trace context is active, the
 * request passes through unchanged.
 *
 * The gateway expects `traceparent` on incoming HTTP requests so it can link
 * MCP tool calls into the same trace as the originating LLM call. The
 * `X-Agent-*` business-correlation headers are also injected when present.
 *
 * A telemetry-enabled request opens an `mcp.client` span for every actual HTTP
 * attempt. Header construction failures reject that attempt: retrying without
 * the active context would create a gateway-owned fragment trace.
 * @param telemetry - optional local tracing provider.
 * @param input - request URL or input accepted by Fetch.
 * @param init - optional Fetch initialization.
 * @returns the gateway response.
 */
export function traceAwareFetch(telemetry: TraceTelemetry | undefined, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const active = getTraceContext()
  if (active === undefined) return globalThis.fetch(input, init)
  const request = async (): Promise<Response> => {
    const telemetryTraceparent = telemetry?.active()?.traceparent
    const headers = {
      ...traceContextHeaders(),
      ...telemetryTraceparent === undefined ? {} : { traceparent: telemetryTraceparent },
    }
    if (Object.keys(headers).length === 0) return globalThis.fetch(input, init)
    const merged = new Headers(init?.headers)
    for (const [key, value] of Object.entries(headers)) {
      // Harness owns correlation headers. Deployment headers cannot make a
      // request leave the active local trace.
      merged.set(key, value)
    }
    return globalThis.fetch(input, { ...init, headers: merged })
  }
  return telemetry === undefined ? request() : telemetry.withinSpan({ name: 'mcp.client' }, request)
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param telemetry - optional local tracing provider.
 * @returns A connected-ready MCP Transport (stdio, Streamable HTTP, or SSE).
 */
export function createTransport(config: Config, telemetry?: TraceTelemetry): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers }, fetch: (input, init) => traceAwareFetch(telemetry, input, init) },
      ) as Transport
    case 'sse':
      // The legacy SSE transport reads its request headers (also applied to
      // the upstream message POSTs) from `requestInit`, mirroring the
      // streamable-http branch above.
      // oxlint-disable-next-line typescript/no-deprecated -- legacy servers still require this transport.
      return new SSEClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers }, fetch: (input, init) => traceAwareFetch(telemetry, input, init) },
      )
  }
}
