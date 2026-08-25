/** Package-owned gateway-trace association invariant. @module @deepseek-ai/dsh-gateway-trace/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-gateway-trace'

/** Cordis companion plugin name. */
export const name = 'gateway-trace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Reject a `gateway/trace` event that no earlier `assistant/message` or
 * `tool/result` event anchors. A request id joins exactly when present;
 * trace-only correlations join by their trace id. When both ids are present,
 * both must agree with the response correlation.
 * An anchor at a seq greater than or equal to the trace record is not prior, so
 * a record whose only match follows it still fails.
 */
function validateGatewayTrace(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'gateway/trace') return
  const data = event.data
  const anchor = session.events.find((e) => {
    if (e.seq >= event.seq) return false
    if (e.type === 'assistant/message') {
      const correlation = e.data.traceMeta
      return correlation !== undefined
        && (data.requestId === undefined || correlation.requestId === data.requestId)
        && (correlation.traceId === undefined || correlation.traceId === data.traceId)
    }
    if (e.type === 'tool/result') {
      return e.data.gatewayResponseCorrelations?.some(correlation =>
        (data.requestId === undefined || correlation.requestId === data.requestId)
        && (correlation.traceId === undefined || correlation.traceId === data.traceId),
      ) === true
    }
    return false
  })
  if (anchor === undefined) {
    fail(`gateway/trace for trace "${data.traceId}" has no prior response-correlation anchor`)
  }
}

/** Install the gateway-trace association contribution into its child registration fiber. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // Seed: validate existing logs (replay, fork, resume, reload). Honest logs
  // were rejected pre-commit when first written; this also catches a hand-crafted
  // or forked log whose gateway/trace records never had an anchor.
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateGatewayTrace(session, event, fail)
  }
  ctx.on('session/created', (session) => {
    for (const event of session.events) validateGatewayTrace(session, event, fail)
  }, { global: true })

  // Live: reject an unanchored gateway/trace before it commits. internal/dispatch
  // fires before Session.append pushes the event to the log, so fail() here
  // rejects the append rather than leaving a corrupt record behind.
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateGatewayTrace(session, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the gateway-trace invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
