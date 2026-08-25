/**
 * Optional Higress Console Basic provider for gateway trace reverse queries.
 * @module @deepseek-ai/dsh-gateway-trace-console
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import GatewayTraceService, { queryGatewayTrace, type GatewayTraceQueryAttempt } from '@deepseek-ai/dsh-gateway-trace'
import type { GatewayTraceLookup, GatewayTraceObservation } from '@deepseek-ai/dsh-gateway-trace'
import type {} from '@deepseek-ai/dsh-gateway-trace/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { GatewayTraceConsoleConfig, GatewayTraceRetry, ResolvedGatewayTraceConsoleConfig } from './types.ts'

export type { GatewayTraceConsoleConfig, GatewayTraceRetry, ResolvedGatewayTraceConsoleConfig } from './types.ts'

const DEFAULT_RETRY: Required<GatewayTraceRetry> = {
  maxRetries: 3,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  maxConcurrentQueries: 4,
}

/** Validate and materialize Console deployment configuration.
 * @param config - configured provider options.
 * @returns validated provider options.
 */
export function resolveGatewayTraceConsoleConfig(config: GatewayTraceConsoleConfig): ResolvedGatewayTraceConsoleConfig {
  let consoleBaseUrl: URL
  try {
    consoleBaseUrl = new URL(config.consoleBaseUrl)
  } catch {
    throw new TypeError('gateway-trace-console: consoleBaseUrl must be an absolute URL')
  }
  if (consoleBaseUrl.protocol !== 'https:' && consoleBaseUrl.protocol !== 'http:') {
    throw new TypeError('gateway-trace-console: consoleBaseUrl must use http or https')
  }
  if (!consoleBaseUrl.pathname.endsWith('/')) consoleBaseUrl.pathname += '/'
  if (!consoleBaseUrl.pathname.endsWith('/v1/observability/')) {
    consoleBaseUrl = new URL('v1/observability/', consoleBaseUrl)
  }
  if ((config.basicUsernameRef === undefined) !== (config.basicPasswordRef === undefined)) {
    throw new TypeError('gateway-trace-console: Basic credential references must be configured together')
  }
  const retry = { ...DEFAULT_RETRY, ...config.retry }
  if (!Object.values(retry).every(value => Number.isSafeInteger(value) && value > 0) || retry.maxDelayMs < retry.initialDelayMs) {
    throw new TypeError('gateway-trace-console: retry values must be positive integers and maxDelayMs must not be lower than initialDelayMs')
  }
  const basicCredentials = config.basicUsernameRef === undefined || config.basicPasswordRef === undefined
    ? {}
    : {
      basicUsernameRef: credentialRef(config.basicUsernameRef),
      basicPasswordRef: credentialRef(config.basicPasswordRef),
    }
  return {
    consoleBaseUrl,
    ...basicCredentials,
    reflect: config.reflect ?? true,
    retry,
  }
}

/** Trusted-server adapter that calls Higress Console using HTTP Basic credentials. */
export class ConsoleGatewayTraceService extends GatewayTraceService {
  static Config: z<GatewayTraceConsoleConfig> = z.object({
    consoleBaseUrl: z.string().required(),
    basicUsernameRef: z.string().role('credential-ref'),
    basicPasswordRef: z.string().role('credential-ref'),
    reflect: z.boolean().default(true),
    retry: z.object({
      maxRetries: z.number().step(1).min(1).default(DEFAULT_RETRY.maxRetries),
      initialDelayMs: z.number().step(1).min(1).default(DEFAULT_RETRY.initialDelayMs),
      maxDelayMs: z.number().step(1).min(1).default(DEFAULT_RETRY.maxDelayMs),
      maxConcurrentQueries: z.number().step(1).min(1).default(DEFAULT_RETRY.maxConcurrentQueries),
    }),
  })

  /** Validated provider configuration. */
  readonly config: ResolvedGatewayTraceConsoleConfig
  private readonly reflected = new WeakMap<Session, Set<string>>()
  private readonly pending = new Set<AbortController>()
  private readonly queue: (() => void)[] = []
  private active = 0
  private warnedMissingCredential = false

  constructor(ctx: Context, config: GatewayTraceConsoleConfig) {
    super(ctx)
    this.config = resolveGatewayTraceConsoleConfig(config)
    if (this.config.reflect) ctx.on('session/event', (session, event) => {
      for (const anchor of anchorsOf(event)) if (this.claim(session, anchor)) this.enqueue(() => this.reflect(session, anchor))
    })
    ctx.effect(() => () => {
      for (const controller of this.pending) controller.abort()
      this.queue.length = 0
    }, 'gateway-trace-console: cancel pending Console queries')
  }

  /** Query Console by exact request id or independently captured W3C trace id. */
  override async query(correlation: GatewayTraceLookup): Promise<GatewayTraceObservation | undefined> {
    const authorization = await this.resolveBasicAuthorization()
    if (authorization === undefined) return undefined
    return (await this.queryWithAuthorization(correlation, authorization)).detail
  }

  private async queryWithAuthorization(
    correlation: GatewayTraceLookup,
    authorization: string,
    signal?: AbortSignal,
  ): Promise<GatewayTraceQueryAttempt> {
    return queryGatewayTrace(this.config.consoleBaseUrl, correlation, authorization, (url, token, requestSignal) => this.response(url, token, requestSignal), signal, { byRequestPath: 'traces/by-request' })
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
    const controller = new AbortController()
    this.pending.add(controller)
    try {
      for (let attempt = 0; attempt < this.config.retry.maxRetries && !controller.signal.aborted; attempt++) {
        const authorization = await this.resolveBasicAuthorization()
        if (authorization === undefined) return
        const result = await this.queryWithAuthorization(anchor, authorization, controller.signal)
        if (result.detail !== undefined) {
          if (anchor.traceId !== undefined && result.detail.traceId !== anchor.traceId) return
          session.append('gateway/trace', { turn: anchor.turn, step: anchor.step, ...result.detail }, { ignorable: true })
          return
        }
        if (!result.retry || attempt + 1 === this.config.retry.maxRetries) return
        await delay(Math.min(this.config.retry.maxDelayMs, this.config.retry.initialDelayMs * 2 ** attempt), controller.signal)
      }
    } finally { this.pending.delete(controller) }
  }

  private async resolveBasicAuthorization(): Promise<string | undefined> {
    if (this.config.basicUsernameRef === undefined || this.config.basicPasswordRef === undefined) return undefined
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      const [username, password] = await Promise.all([
        credentials.resolve(this.config.basicUsernameRef),
        credentials.resolve(this.config.basicPasswordRef),
      ])
      if (username?.value !== undefined && password?.value !== undefined) {
        return `Basic ${Buffer.from(`${username.value}:${password.value}`).toString('base64')}`
      }
    }
    if (!this.warnedMissingCredential) { this.warnedMissingCredential = true; this.ctx.logger.warn('gateway-trace-console: Console Basic credentials are not configured; reverse queries are disabled') }
    return undefined
  }

  private response(url: URL, authorization: string, signal?: AbortSignal): Promise<Response> {
    return fetch(url, { headers: { accept: 'application/json', authorization }, ...signal === undefined ? {} : { signal } })
  }
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

export default ConsoleGatewayTraceService
