import type { GatewayTraceId } from '@deepseek-ai/dsh-llm'
import { jsonObject, normalizeGatewayTrace, responseErrorCode } from './normalize.ts'
import type { GatewayTraceLookup, GatewayTraceObservation } from './types.ts'

/** One bounded attempt against a Trace observability endpoint. */
export interface GatewayTraceQueryAttempt {
  detail?: GatewayTraceObservation
  retry: boolean
}

/** Provider-specific path override for Console's nested request index. */
export interface GatewayTraceQueryOptions {
  byRequestPath?: string
}

/** Authorization callback used by trusted Host-side Trace providers. */
export type GatewayTraceAuthorizer = (signal?: AbortSignal) => Promise<string | undefined>

/** Fetch implementation used by a Host-side Trace provider. */
export type GatewayTraceFetcher = (url: URL, authorization: string, signal?: AbortSignal) => Promise<Response>

/**
 * Query one complete or reconstructed Trace through a trusted observability
 * endpoint. The caller owns credentials and retry scheduling; this helper
 * owns only the request-id → trace-id → spans protocol.
 * @param baseUrl - endpoint root ending in the provider-specific API path.
 * @param correlation - request id and/or W3C trace id from one response.
 * @param authorization - resolved Authorization header value.
 * @param fetcher - provider-owned HTTP transport.
 * @param signal - optional cancellation signal.
 * @param options - provider-specific request-index path override.
 * @returns sanitized Trace detail and whether a 503 should be retried.
 */
export async function queryGatewayTrace(
  baseUrl: URL,
  correlation: GatewayTraceLookup,
  authorization: string,
  fetcher: GatewayTraceFetcher,
  signal?: AbortSignal,
  options: GatewayTraceQueryOptions = {},
): Promise<GatewayTraceQueryAttempt> {
  try {
    let traceId = correlation.traceId
    let index: unknown
    if (correlation.requestId !== undefined) {
      const response = await fetcher(new URL(`${options.byRequestPath ?? 'by-request'}/${encodeURIComponent(correlation.requestId)}`, baseUrl), authorization, signal)
      if (!response.ok) return { retry: response.status === 503 }
      index = await response.json()
      const resolved = jsonObject(index)?.traceId
      if (typeof resolved !== 'string' || resolved.length === 0) return { retry: false }
      traceId = resolved as GatewayTraceId
    }
    if (traceId === undefined) return { retry: false }
    let trace = await fetcher(new URL(`traces/${encodeURIComponent(traceId)}`, baseUrl), authorization, signal)
    let source: GatewayTraceObservation['source'] = 'tempo'
    if (trace.status === 404 && await responseErrorCode(trace) === 'tempo_trace_not_found') {
      trace = await fetcher(new URL(`traces/reconstructed/${encodeURIComponent(traceId)}`, baseUrl), authorization, signal)
      source = 'reconstructed'
    }
    if (!trace.ok) return { retry: trace.status === 503 }
    return {
      detail: {
        ...normalizeGatewayTrace(traceId, source, index, await trace.json()),
        ...(correlation.requestId === undefined ? {} : { requestId: correlation.requestId }),
      },
      retry: false,
    }
  } catch {
    return { retry: false }
  }
}
