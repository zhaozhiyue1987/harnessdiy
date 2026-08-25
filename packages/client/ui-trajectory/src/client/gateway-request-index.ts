/** Pure, lazy gateway-request index for the Trajectory Consumer. */

import type { GatewayTraceSpan } from '@deepseek-ai/dsh-gateway-trace'
import type { TrajectoryGatewayTrace } from './trajectory-contract.ts'

/** Semantic category derived only from allow-listed Higress span names. */
export type GatewayRequestKind = 'model' | 'mcp' | 'unknown'

/** One de-duplicated sanitized span with the observation that supplied it. */
export interface GatewayIndexedSpan {
  /** Stable identity local to one sanitized trace result. */
  readonly key: string
  /** Presentation-safe span facts. */
  readonly span: GatewayTraceSpan
  /** Durable Trajectory observation that supplied the span. */
  readonly trace: TrajectoryGatewayTrace
}

/** One real Higress request rooted at `higress.gateway.request`. */
export interface GatewayRequestRecord {
  /** Stable React key made from the trace and root span identity. */
  readonly id: string
  /** Sanitized trace id that groups the root and its visible descendants. */
  readonly traceId: string
  /** Root gateway request span. */
  readonly root: GatewayIndexedSpan
  /** Exact gateway request id when the root span contains one. */
  readonly requestId?: string
  /** Model, MCP, or an otherwise unclassified gateway request. */
  readonly kind: GatewayRequestKind
  /** Model id, MCP service id, route id, or a neutral fallback. */
  readonly objectLabel: string
  /** HTTP status supplied by the root span or exact observation. */
  readonly statusCode?: number
  /** Root gateway-request start time when the provider supplied it. */
  readonly startedAtMs?: number
  /** Whether Higress explicitly identifies this request as a probe. */
  readonly isProbe: boolean
}

/** De-duplicated span pools and request roots, assembled without network access. */
export interface GatewayRequestIndex {
  /** Real gateway requests in newest-first order. */
  readonly records: readonly GatewayRequestRecord[]
  /** Span pools keyed by trace id; branch construction reads only the selected pool. */
  readonly spansByTrace: ReadonlyMap<string, readonly GatewayIndexedSpan[]>
}

/** A selected record's authorized branch, with no invented missing parents. */
export interface GatewayRequestBranchNode {
  /** Sanitized span at this branch node. */
  readonly span: GatewayIndexedSpan
  /** Visible children whose parent id names this span. */
  readonly children: readonly GatewayRequestBranchNode[]
}

function requestIdOf(span: GatewayTraceSpan): string | undefined {
  return span.requestId ?? (typeof span.attributes['higress.request_id'] === 'string'
    ? span.attributes['higress.request_id']
    : undefined)
}

function spanKey(trace: TrajectoryGatewayTrace, span: GatewayTraceSpan, position: number): string {
  if (span.spanId !== undefined) return `${trace.traceId}:${span.spanId}`
  return [
    trace.traceId,
    span.name,
    requestIdOf(span) ?? '',
    span.startedAtMs ?? '',
    span.durationMs ?? '',
    position,
  ].join(':')
}

function exactObservationFor(
  root: GatewayIndexedSpan,
  candidates: readonly GatewayIndexedSpan[],
): GatewayIndexedSpan {
  const requestId = requestIdOf(root.span)
  if (requestId === undefined) return root
  return candidates.find(candidate => requestIdOf(candidate.span) === requestId) ?? root
}

function childrenOf(
  spans: readonly GatewayIndexedSpan[],
  spanId: string | undefined,
): readonly GatewayIndexedSpan[] {
  if (spanId === undefined) return []
  return spans.filter(candidate => candidate.span.parentSpanId === spanId)
}

function parentOf(
  spans: readonly GatewayIndexedSpan[],
  span: GatewayIndexedSpan,
): GatewayIndexedSpan | undefined {
  const parentId = span.span.parentSpanId
  return parentId === undefined ? undefined : spans.find(candidate => candidate.span.spanId === parentId)
}

function descendantsOf(
  spans: readonly GatewayIndexedSpan[],
  root: GatewayIndexedSpan,
): readonly GatewayIndexedSpan[] {
  const descendants: GatewayIndexedSpan[] = []
  const pending = [...childrenOf(spans, root.span.spanId)]
  const visited = new Set<string>([root.key])
  while (pending.length > 0) {
    const current = pending.shift()
    if (current === undefined) continue
    if (visited.has(current.key)) continue
    visited.add(current.key)
    descendants.push(current)
    pending.push(...childrenOf(spans, current.span.spanId))
  }
  return descendants
}

function classification(
  root: GatewayIndexedSpan,
  descendants: readonly GatewayIndexedSpan[],
): Pick<GatewayRequestRecord, 'kind' | 'objectLabel'> {
  const model = descendants.find(candidate => candidate.span.name === 'higress.ai.model')
  if (model !== undefined) {
    return {
      kind: 'model',
      objectLabel: String(
        model.span.attributes['gen_ai.response.model']
        ?? model.span.attributes['gen_ai.request.model']
        ?? root.trace.observation.modelId
        ?? root.trace.observation.routeId
        ?? '模型请求',
      ),
    }
  }
  const mcp = descendants.find(candidate => candidate.span.name === 'higress.mcp.call')
  if (mcp !== undefined) {
    return {
      kind: 'mcp',
      objectLabel: String(
        mcp.span.attributes['mcp.service']
        ?? root.trace.observation.mcpServiceId
        ?? root.trace.observation.routeId
        ?? 'MCP 请求',
      ),
    }
  }
  return {
    kind: 'unknown',
    objectLabel: root.trace.observation.routeId ?? '网关请求',
  }
}

function statusCode(root: GatewayIndexedSpan): number | undefined {
  const status = root.span.attributes['http.response.status_code']
  return typeof status === 'number' ? status : root.trace.observation.statusCode
}

/**
 * Build request roots from already-sanitized session observations.
 * @param traces - durable gateway observations attached to local stages.
 * @returns index with no transport, credential, or Session mutation.
 */
export function indexGatewayRequests(
  traces: Iterable<TrajectoryGatewayTrace>,
): GatewayRequestIndex {
  const spansByTrace = new Map<string, GatewayIndexedSpan[]>()
  for (const trace of traces) {
    const pool = spansByTrace.get(trace.traceId) ?? []
    const known = new Map(pool.map(span => [span.key, span]))
    trace.spans.forEach((span, position) => {
      const key = spanKey(trace, span, position)
      const candidate = { key, span, trace }
      const previous = known.get(key)
      if (previous === undefined || (
        requestIdOf(candidate.span) !== undefined
        && candidate.trace.requestId === requestIdOf(candidate.span)
      )) {
        known.set(key, candidate)
      }
    })
    const resolved = [...known.values()]
    spansByTrace.set(trace.traceId, resolved)
  }
  const records: GatewayRequestRecord[] = []
  for (const [traceId, spans] of spansByTrace) {
    for (const root of spans) {
      if (root.span.name !== 'higress.gateway.request') continue
      const exact = exactObservationFor(root, spans)
      const descendants = descendantsOf(spans, root)
      const detail = classification(exact, descendants)
      const requestId = requestIdOf(exact.span)
      const resolvedStatusCode = statusCode(exact)
      const startedAtMs = exact.span.startedAtMs
      records.push({
        id: `${traceId}:${root.key}`,
        traceId,
        root: exact,
        ...detail,
        ...resolvedStatusCode === undefined ? {} : { statusCode: resolvedStatusCode },
        ...startedAtMs === undefined ? {} : { startedAtMs },
        isProbe: exact.trace.observation.eventType === 'probe',
        ...requestId === undefined ? {} : { requestId },
      })
    }
  }
  records.sort((left, right) => (right.startedAtMs ?? -Infinity) - (left.startedAtMs ?? -Infinity)
    || left.id.localeCompare(right.id))
  return { records, spansByTrace }
}

/**
 * Construct only the selected request's visible span hierarchy.
 * @param index - request index built from sanitized observations.
 * @param record - selected real gateway request root.
 * @returns the root and authorized descendants; no missing parent is synthesized.
 */
export function gatewayRequestBranch(
  index: GatewayRequestIndex,
  record: GatewayRequestRecord,
): GatewayRequestBranchNode {
  const spans = index.spansByTrace.get(record.traceId) ?? []
  let branchRoot = record.root
  const ancestors = new Set<string>()
  while (true) {
    if (ancestors.has(branchRoot.key)) break
    ancestors.add(branchRoot.key)
    const parent = parentOf(spans, branchRoot)
    if (parent === undefined) break
    branchRoot = parent
  }
  const build = (current: GatewayIndexedSpan, ancestors: ReadonlySet<string>): GatewayRequestBranchNode => {
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(current.key)
    return {
      span: current,
      children: childrenOf(spans, current.span.spanId)
        .filter(child => !nextAncestors.has(child.key))
        .map(child => build(child, nextAncestors)),
    }
  }
  return build(branchRoot, new Set())
}
