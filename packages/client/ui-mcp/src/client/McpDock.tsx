/** Input dock entry: the current session's MCP binding chips. Bound servers
 * show their names plus a tool count and an unbind affordance; unbound
 * catalog servers show a bind affordance, inviting tools into this session.
 * Renders nothing when there is nothing to show.
 * @module @deepseek-ai/dsh-client-ui-mcp/client/McpDock
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { McpActionResult, McpSessionController } from './controller.ts'
import { useSnapshot } from './use-snapshot.ts'
import css from './McpDock.module.css'

/** Object layer injected by the session-scoped conversation.input.dock entry. */
export interface McpDockInjected {
  controller: McpSessionController
}

/** Full dock props: input-region owner kit + this plugin's inject face + copy. */
export type McpDockProps = PropsRuntime<'conversation.input.dock'> & McpDockInjected & PropsLocale<'mcp'>

/** Strip of per-session binding chips and bind affordances. */
export function McpDock({ controller, t }: McpDockProps) {
  const view = useSnapshot(controller)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => { controller.load() }, [controller])

  const run = async (serverName: string, action: (name: string) => Promise<McpActionResult>): Promise<void> => {
    setBusy(serverName)
    const result = await action(serverName)
    setBusy(null)
    setError(result.ok ? null : `${t('error.action')}: ${result.message}`)
  }

  const boundNames = new Set(view.servers.map(server => server.serverName))
  const unbound = view.catalog.filter(server => !boundNames.has(server.serverName))
  if (view.servers.length === 0 && unbound.length === 0) return null

  const expandedServer = view.servers.find(server => server.serverName === expanded) ?? null
  // The bound view carries the live tool inventory; the catalog spec adds the
  // transport endpoint detail for the expanded panel.
  const expandedSpec = expandedServer === null
    ? null
    : view.catalog.find(server => server.serverName === expandedServer.serverName) ?? null
  const expandedMeta = expandedSpec === null
    ? ''
    : expandedSpec.transport === 'stdio'
      ? `stdio · ${expandedSpec.command}`
      : `${expandedSpec.transport} · ${expandedSpec.url ?? ''}`

  return (
    <div className={css.dock} aria-label={t('dock.label')}>
      {view.status === 'error' ? <span className={css.error}>{`${t('error.load')}: ${view.error}`}</span> : null}
      {error !== null ? <span className={css.error}>{error}</span> : null}
      {view.servers.map(server => (
        <span key={server.serverName} className={css.chip}>
          <button
            type="button"
            className={css.chipInfo}
            aria-expanded={expanded === server.serverName}
            aria-controls={`mcp-dock-detail-${server.serverName}`}
            title={t('action.detail')}
            onClick={() => { setExpanded(expanded === server.serverName ? null : server.serverName) }}
          >
            <span className={css.chipName}>{server.serverName}</span>
            <span className={css.chipCount}>{server.tools.length}</span>
          </button>
          <button
            type="button"
            className={css.chipAction}
            disabled={busy !== null}
            onClick={() => void run(server.serverName, name => controller.unbind(name))}
          >
            {t('action.unbind')}
          </button>
        </span>
      ))}
      {unbound.map(server => (
        <button
          key={server.serverName}
          type="button"
          className={css.bind}
          disabled={busy !== null}
          onClick={() => void run(server.serverName, name => controller.bind(name))}
        >
          {`+ ${t('action.bind')} ${server.serverName}`}
        </button>
      ))}
      {expandedServer !== null ? (
        <div className={css.detail} id={`mcp-dock-detail-${expandedServer.serverName}`}>
          <div className={css.detailMeta}>{expandedMeta}</div>
          <div className={css.detailToolsTitle}>{`${t('detail.tools')} (${expandedServer.tools.length})`}</div>
          {expandedServer.tools.length === 0
            ? <p className={css.toolsEmpty}>{t('detail.toolsEmpty')}</p>
            : (
              <ul className={css.toolList}>
                {expandedServer.tools.map(tool => (
                  <li key={tool.publicName} className={css.tool}>
                    <code className={css.toolName}>{tool.rawName}</code>
                    <span className={css.toolDesc}>{tool.description}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      ) : null}
    </div>
  )
}
