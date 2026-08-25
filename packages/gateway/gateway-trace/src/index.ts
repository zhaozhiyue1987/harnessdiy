/**
 * Gateway-trace Service Definition (`ctx.gatewayTrace`): providers subclass
 * {@link GatewayTraceService} to reverse-query the Higress observability API for
 * per-stage token, time-to-first-token, model, and cost data, then append a
 * `gateway/trace` session event anchored to the stage's `assistant/message` or
 * `tool/result`. The rationale is in the
 * [gateway-trace Agent Note](../../../../.agents/notes/implemented/feature/2026-08-18-higress-gateway-trace.md).
 * @module @deepseek-ai/dsh-gateway-trace
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { GatewayTraceLookup, GatewayTraceObservation } from './types.ts'

export {
  GatewaySpanId,
  type GatewayTraceLookup,
  type GatewayTraceObservation,
  type GatewayTraceSpan,
  type GatewayTraceTiming,
} from './types.ts'
export { jsonObject, normalizeGatewayTrace, responseErrorCode } from './normalize.ts'
export { queryGatewayTrace, type GatewayTraceAuthorizer, type GatewayTraceFetcher, type GatewayTraceQueryAttempt, type GatewayTraceQueryOptions } from './query.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gatewayTrace: GatewayTraceService
  }
}

/**
 * Abstract gateway-trace service. `query` is a pure reverse-query: it resolves
 * credentials, performs the gateway HTTP call, and returns the per-stage detail.
 * The provider package orchestrates the listen → `query` → append flow that
 * reflects the detail into a `gateway/trace` session event anchored to the stage;
 * `query` itself appends nothing and holds no session context, which is why
 * `GatewayTraceObservation` excludes the session-side `turn`/`step`. The service
 * degrades to returning `undefined` when the gateway is unreachable or no
 * credential is configured — no data, no crash. Load one implementation per
 * context as `ctx.gatewayTrace`.
 */
export abstract class GatewayTraceService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'gatewayTrace')
  }

  /**
   * Reverse-query the gateway from either independent response correlation key.
   * @param correlation - exact request id and/or W3C trace id from the response.
   * @returns sanitized observation, or `undefined` when no usable key or data exists.
   */
  abstract query(correlation: GatewayTraceLookup): Promise<GatewayTraceObservation | undefined>
}

export default GatewayTraceService
