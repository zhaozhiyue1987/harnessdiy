/** Gateway-first request list that expands one sanitized Higress branch on demand. */

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { GatewayRequestBranchNode, GatewayRequestIndex, GatewayRequestRecord } from './gateway-request-index.ts'
import { gatewayRequestBranch } from './gateway-request-index.ts'
import css from './GatewayRequestList.module.css'

function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return '—'
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`
}

function formatTime(time: number | undefined): string {
  if (time === undefined) return '时间未提供'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(new Date(time))
}

function requestType(kind: GatewayRequestRecord['kind']): string {
  switch (kind) {
    case 'model': return '模型'
    case 'mcp': return 'MCP'
    case 'unknown': return '网关'
  }
}

function GatewayBranch({ node, level = 0 }: { node: GatewayRequestBranchNode; level?: number }) {
  const status = node.span.span.attributes['http.response.status_code']
  const attributes = Object.entries(node.span.span.attributes)
  return (
    <li className={css.branchNode} style={{ '--gateway-branch-level': level } as CSSProperties}>
      <div className={css.branchSummary}>
        <span className={css.branchName}>{node.span.span.name}</span>
        <span>{formatDuration(node.span.span.durationMs)}</span>
        {status !== undefined && <span>HTTP {status}</span>}
      </div>
      {attributes.length > 0 && (
        <dl className={css.attributes}>
          {attributes.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {node.children.length > 0 && (
        <ul className={css.branchChildren}>
          {node.children.map(child => <GatewayBranch key={child.span.key} node={child} level={level + 1} />)}
        </ul>
      )}
    </li>
  )
}

/**
 * Render real gateway model and MCP requests before the local trajectory ledger.
 * @param index - gateway requests derived from already-sanitized session observations.
 */
export function GatewayRequestList({ index }: { index: GatewayRequestIndex }) {
  const [hideProbes, setHideProbes] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const records = useMemo(
    () => hideProbes ? index.records.filter(record => !record.isProbe) : index.records,
    [hideProbes, index.records],
  )
  const selected = records.find(record => record.id === selectedId)
  const branch = useMemo(
    () => selected === undefined ? undefined : gatewayRequestBranch(index, selected),
    [index, selected],
  )

  if (index.records.length === 0) return null
  return (
    <section className={css.root} aria-label="网关请求">
      <header className={css.header}>
        <div>
          <h2>网关请求</h2>
          <p>优先显示 Higress 已确认的模型与 MCP HTTP 请求。</p>
        </div>
        <label className={css.probeFilter}>
          <input
            type="checkbox"
            checked={hideProbes}
            onChange={(event) => { setHideProbes(event.target.checked) }}
          />
          隐藏探测请求
        </label>
      </header>
      {records.length === 0 ? (
        <p className={css.empty}>已隐藏所有已明确标记的探测请求。</p>
      ) : (
        <div className={css.records} role="list">
          {records.map((record) => {
            const selectedRecord = record.id === selectedId
            return (
              <div className={css.record} key={record.id} role="listitem" data-gateway-request={record.requestId}>
                <button
                  type="button"
                  className={selectedRecord ? `${css.recordButton} ${css.recordButtonSelected}` : css.recordButton}
                  aria-expanded={selectedRecord}
                  onClick={() => { setSelectedId(current => current === record.id ? null : record.id) }}
                >
                  <span className={css.recordIdentity}>
                    <span className={`${css.kind} ${css[`kind${record.kind}`]}`}>{requestType(record.kind)}</span>
                    <span className={css.object}>{record.objectLabel}</span>
                  </span>
                  <span className={css.requestTime}>{formatTime(record.startedAtMs)}</span>
                  <span className={css.requestStatus}>
                    {record.statusCode === undefined ? '状态未提供' : `HTTP ${record.statusCode}`}
                    {' · '}{formatDuration(record.root.span.durationMs)}
                  </span>
                  <span className={css.requestId}>{record.requestId ?? 'Request ID 未提供'}</span>
                </button>
                {selectedRecord && branch !== undefined && (
                  <div className={css.detail}>
                    <p className={css.context}>
                      本地关联：Turn {record.root.trace.turn} · Step {record.root.trace.step} · {record.root.trace.source === 'tempo' ? 'Tempo' : '重建结果'}
                    </p>
                    {branch.span.key === record.root.key && record.root.span.parentSpanId !== undefined && (
                      <p className={css.limited}>上级 Span 不在已授权的网关结果中。</p>
                    )}
                    <ul className={css.branch} aria-label={`${record.requestId ?? record.objectLabel} 的 Span 分支`}>
                      <GatewayBranch node={branch} />
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
