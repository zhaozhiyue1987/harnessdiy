/** Higress Gateway Trace Query service-account provider. @module @deepseek-ai/dsh-gateway-trace-query */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import GatewayTraceService, { queryGatewayTrace, type GatewayTraceQueryAttempt } from '@deepseek-ai/dsh-gateway-trace'
import type { GatewayTraceLookup, GatewayTraceObservation } from '@deepseek-ai/dsh-gateway-trace'
import type {} from '@deepseek-ai/dsh-gateway-trace/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Retry policy for background visibility lag and service unavailability. */
export interface GatewayTraceQueryRetry {
  /** Maximum attempts including the initial query. */
  maxAttempts?: number
  /** Initial backoff delay in milliseconds. */
  initialDelayMs?: number
  /** Largest backoff delay in milliseconds. */
  maxDelayMs?: number
  /** Maximum background queries running at once. */
  maxConcurrentQueries?: number
}

/** Gateway Trace Query service-account configuration. */
export interface GatewayTraceQueryConfig {
  /** Gateway Trace Query base URL ending in `/__higress/trace-query/v1`. */
  traceQueryBaseUrl: string
  /** Credential reference resolving to the service-account Bearer token. */
  tokenRef?: string
  /** Whether response-correlated stages are reflected in the background. */
  reflect?: boolean
  /** Retry configuration for background reflection. */
  retry?: GatewayTraceQueryRetry
}

interface ResolvedConfig {
  traceQueryBaseUrl: URL
  tokenRef?: import('@deepseek-ai/dsh-credentials').CredentialRef
  reflect: boolean
  retry: Required<GatewayTraceQueryRetry>
}

const DEFAULT_RETRY: Required<GatewayTraceQueryRetry> = {
  maxAttempts: 4,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  maxConcurrentQueries: 4,
}

/** Resolve configuration before provider operations begin.
 * @param config - configured provider options.
 * @returns validated provider options.
 */
export function resolveGatewayTraceQueryConfig(config: GatewayTraceQueryConfig): ResolvedConfig {
  let traceQueryBaseUrl: URL
  try {
    traceQueryBaseUrl = new URL(config.traceQueryBaseUrl)
  } catch {
    throw new TypeError('gateway-trace-query: traceQueryBaseUrl must be an absolute URL')
  }
  if (traceQueryBaseUrl.protocol !== 'https:' && traceQueryBaseUrl.protocol !== 'http:') {
    throw new TypeError('gateway-trace-query: traceQueryBaseUrl must use http or https')
  }
  if (!traceQueryBaseUrl.pathname.endsWith('/')) traceQueryBaseUrl.pathname += '/'
  const retry = { ...DEFAULT_RETRY, ...config.retry }
  if (!Object.values(retry).every(value => Number.isSafeInteger(value) && value > 0) || retry.maxDelayMs < retry.initialDelayMs) {
    throw new TypeError('gateway-trace-query: retry values must be positive integers and maxDelayMs must not be lower than initialDelayMs')
  }
  return {
    traceQueryBaseUrl,
    ...config.tokenRef === undefined ? {} : { tokenRef: credentialRef(config.tokenRef) },
    reflect: config.reflect ?? true,
    retry,
  }
}

/** Default trusted-server provider using a least-privilege Trace Query token. */
export class GatewayTraceQueryService extends GatewayTraceService {
  static Config: z<GatewayTraceQueryConfig> = z.object({
    traceQueryBaseUrl: z.string().required(),
    tokenRef: z.string().role('credential-ref'),
    reflect: z.boolean().default(true),
    retry: z.object({
      maxAttempts: z.number().step(1).min(1).default(DEFAULT_RETRY.maxAttempts),
      initialDelayMs: z.number().step(1).min(1).default(DEFAULT_RETRY.initialDelayMs),
      maxDelayMs: z.number().step(1).min(1).default(DEFAULT_RETRY.maxDelayMs),
      maxConcurrentQueries: z.number().step(1).min(1).default(DEFAULT_RETRY.maxConcurrentQueries),
    }),
  })

  /** Validated provider configuration. */
  readonly config: ResolvedConfig
  private readonly reflected = new WeakMap<Session, Set<string>>()
  private readonly queue: (() => void)[] = []
  private readonly pending = new Set<AbortController>()
  private active = 0
  private warnedMissingCredential = false

  constructor(ctx: Context, config: GatewayTraceQueryConfig) {
    super(ctx)
    this.config = resolveGatewayTraceQueryConfig(config)
    if (this.config.reflect) ctx.on('session/event', (session, event) => {
      for (const anchor of anchorsOf(event)) if (this.claim(session, anchor)) this.enqueue(() => this.reflect(session, anchor))
    })
    ctx.effect(() => () => { for (const pending of this.pending) pending.abort(); this.queue.length = 0 }, 'gateway-trace-query: cancel pending reverse queries')
  }

  /** Query the Gateway exact-lookup API from either response correlation key. */
  override async query(correlation: GatewayTraceLookup): Promise<GatewayTraceObservation | undefined> {
    const authorization = await this.resolveAuthorization()
    if (authorization === undefined) return undefined
    return (await this.queryWithAuthorization(correlation, authorization)).detail
  }

  private async queryWithAuthorization(
    correlation: GatewayTraceLookup,
    authorization: string,
    signal?: AbortSignal,
  ): Promise<GatewayTraceQueryAttempt> {
    return queryGatewayTrace(
      this.config.traceQueryBaseUrl,
      correlation,
      authorization,
      (url, token, requestSignal) => this.response(url, token, requestSignal),
      signal,
    )
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue.push(() => { void operation().finally(() => { this.active--; this.startQueued() }) })
    this.startQueued()
  }

  private startQueued(): void {
    while (this.active < this.config.retry.maxConcurrentQueries && this.queue.length > 0) {
      this.active++
      const next = this.queue.shift()
      if (next === undefined) continue
      next()
    }
  }

  private claim(session: Session, anchor: GatewayTraceAnchor): boolean {
    const key = anchor.requestId ?? anchor.traceId
    if (key === undefined) return false
    let ids = this.reflected.get(session)
    if (ids === undefined) this.reflected.set(session, ids = new Set())
    if (ids.has(key)) return false
    ids.add(key)
    return true
  }
  private async reflect(session: Session, anchor: GatewayTraceAnchor): Promise<void> {
    const controller = new AbortController(); this.pending.add(controller)
    try { for (let attempt = 0; attempt < this.config.retry.maxAttempts && !controller.signal.aborted; attempt++) { const authorization = await this.resolveAuthorization(); if (authorization === undefined) return; const result = await this.queryWithAuthorization(anchor, authorization, controller.signal); if (result.detail !== undefined) { if (anchor.traceId !== undefined && result.detail.traceId !== anchor.traceId) return; session.append('gateway/trace', { turn: anchor.turn, step: anchor.step, ...result.detail }, { ignorable: true }); return }; if (!result.retry || attempt + 1 === this.config.retry.maxAttempts) return; await delay(Math.min(this.config.retry.maxDelayMs, this.config.retry.initialDelayMs * 2 ** attempt), controller.signal) } } finally { this.pending.delete(controller) }
  }
  private async resolveAuthorization(): Promise<string | undefined> {
    if (this.config.tokenRef === undefined) return undefined
    const value = await this.ctx.get('credentials')?.resolve(this.config.tokenRef)
    if (value?.value !== undefined) return `Bearer ${value.value}`
    if (!this.warnedMissingCredential) { this.warnedMissingCredential = true; this.ctx.logger.warn('gateway-trace-query: Trace Query token is not configured; reverse queries are disabled') }
    return undefined
  }
  private response(url: URL, authorization: string, signal?: AbortSignal): Promise<Response> { return fetch(url, { headers: { accept: 'application/json', authorization }, ...signal === undefined ? {} : { signal } }) }
}

interface GatewayTraceAnchor extends GatewayTraceLookup {
  turn: number
  step: number
}

function anchorsOf(event: SessionEvent): GatewayTraceAnchor[] {
  if (event.type === 'assistant/message') {
    const correlation = event.data.traceMeta
    const anchor = anchorOf(event.data.turn, event.data.step, correlation)
    return anchor === undefined ? [] : [anchor]
  }
  if (event.type !== 'tool/result') return []
  return (event.data.gatewayResponseCorrelations ?? []).flatMap((correlation) => {
    const anchor = anchorOf(event.data.turn, event.data.step, correlation)
    return anchor === undefined ? [] : [anchor]
  })
}

function anchorOf(
  turn: number,
  step: number,
  correlation: GatewayTraceLookup | undefined,
): GatewayTraceAnchor | undefined {
  if (correlation === undefined || (correlation.requestId === undefined && correlation.traceId === undefined)) return undefined
  return {
    turn,
    step,
    ...correlation.requestId === undefined ? {} : { requestId: correlation.requestId },
    ...correlation.traceId === undefined ? {} : { traceId: correlation.traceId },
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

export default GatewayTraceQueryService
