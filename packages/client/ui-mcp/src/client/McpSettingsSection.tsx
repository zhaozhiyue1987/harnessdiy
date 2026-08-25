/** Settings page: the managed MCP server catalog. Rows carry remove, the
 * footer form adds or replaces by `serverName`. All data flows through the
 * injected {@link McpCatalogController}; the page itself stays shallow.
 * @module @deepseek-ai/dsh-client-ui-mcp/client/McpSettingsSection
 */

import { useEffect, useState, type FormEvent } from 'react'
import type { McpActionResult, McpCatalogController } from './controller.ts'
import type { McpKey } from './locales.ts'
import { useSnapshot } from './use-snapshot.ts'
import type { McpTransport } from '@deepseek-ai/dsh-mcp-manager/types'
import css from './McpSettingsSection.module.css'

/** Object layer + copy injected by the settings.section registration. */
export interface McpSettingsSectionInjected {
  controller: McpCatalogController
  t: (key: McpKey) => string
}

/** Full page props: exactly the inject face (sections carry no owner kit). */
export type McpSettingsSectionProps = McpSettingsSectionInjected

/** A failed action message keyed so repeated failures re-render. */
interface ActionState {
  message: string
  seq: number
}

/** Server catalog page: list, remove, and the add/replace form. */
export function McpSettingsSection({ controller, t }: McpSettingsSectionProps) {
  const view = useSnapshot(controller)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('streamable-http')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<ActionState | null>(null)
  const [fetching, setFetching] = useState<string | null>(null)

  useEffect(() => { controller.load() }, [controller])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const serverName = name.trim()
    if (busy || serverName === '') return
    setBusy(true)
    // exactOptionalPropertyTypes: the untaken transport's field is omitted and
    // a blank args line keeps the `args` key absent rather than `undefined`.
    const httpLike = transport === 'streamable-http' || transport === 'sse'
    const spec = httpLike
      ? { serverName, transport, url: url.trim() } as const
      : {
        serverName,
        transport,
        command: command.trim(),
        ...(args.trim() === '' ? {} : { args: args.trim().split(/\s+/) }),
      } as const
    const result = await controller.upsert(spec)
    setBusy(false)
    if (result.ok) {
      setName('')
      setUrl('')
      setCommand('')
      setArgs('')
      setAction(null)
    } else {
      setAction({ message: `${t('error.action')}: ${result.message}`, seq: Date.now() })
    }
  }

  const remove = async (serverName: string): Promise<void> => {
    const result: McpActionResult = await controller.deleteServer(serverName)
    if (result.ok) {
      setAction(null)
    } else {
      setAction({ message: `${t('error.action')}: ${result.message}`, seq: Date.now() })
    }
  }

  const refreshTools = async (serverName: string): Promise<void> => {
    setFetching(serverName)
    const result = await controller.fetchToolCount(serverName)
    setFetching(null)
    if (!result.ok) {
      setAction({ message: `${t('error.action')}: ${result.message}`, seq: Date.now() })
    }
  }

  return (
    <section className={css.page} aria-label={t('nav')}>
      <p className={css.description}>{t('section.description')}</p>

      {action !== null ? <p className={css.error} key={action.seq}>{action.message}</p> : null}
      {view.status === 'error' ? <p className={css.error}>{`${t('error.load')}: ${view.error}`}</p> : null}

      {view.servers.length === 0
        ? <p className={css.empty}>{t('section.empty')}</p>
        : (
          <ul className={css.list}>
            {view.servers.map((server) => {
              const toolsCount = view.toolCounts.get(server.serverName)
              return (
                <li key={server.serverName} className={css.row}>
                  <span className={css.rowName}>{server.serverName}</span>
                  <span className={css.rowMeta}>
                    {server.transport}
                    {server.transport === 'stdio' ? ` · ${server.command}` : ` · ${server.url ?? ''}`}
                    {toolsCount !== undefined
                      ? <span className={css.toolsCount}>{` · ${toolsCount} ${t('detail.tools')}`}</span>
                      : null}
                  </span>
                  <span className={css.rowActions}>
                    <button
                      type="button"
                      className={css.secondary}
                      disabled={fetching !== null}
                      onClick={() => void refreshTools(server.serverName)}
                      title={t('action.refreshTools')}
                    >
                      {fetching === server.serverName ? t('action.fetching') : t('action.refreshTools')}
                    </button>
                    <button
                      type="button"
                      className={css.danger}
                      onClick={() => void remove(server.serverName)}
                    >
                      {t('action.remove')}
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}

      <form className={css.form} onSubmit={(event) => { void submit(event) }}>
        <label className={css.field}>
          <span className={css.label}>{t('form.name')}</span>
          <input
            className={css.input}
            value={name}
            placeholder={t('form.name.placeholder')}
            onChange={(event) => { setName(event.target.value) }}
            required
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>{t('form.transport')}</span>
          <select
            className={css.input}
            value={transport}
            onChange={(event) => { setTransport(event.target.value as McpTransport) }}
          >
            <option value="streamable-http">{t('form.transport.http')}</option>
            <option value="sse">{t('form.transport.sse')}</option>
            <option value="stdio">{t('form.transport.stdio')}</option>
          </select>
        </label>
        {transport !== 'stdio'
          ? (
            <label className={css.field}>
              <span className={css.label}>{t('form.url')}</span>
              <input
                className={css.input}
                value={url}
                placeholder={t('form.url.placeholder')}
                onChange={(event) => { setUrl(event.target.value) }}
              />
            </label>
          )
          : (
            <>
              <label className={css.field}>
                <span className={css.label}>{t('form.command')}</span>
                <input
                  className={css.input}
                  value={command}
                  placeholder={t('form.command.placeholder')}
                  onChange={(event) => { setCommand(event.target.value) }}
                />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('form.args')}</span>
                <input
                  className={css.input}
                  value={args}
                  onChange={(event) => { setArgs(event.target.value) }}
                />
              </label>
            </>
          )}
        <button type="submit" className={css.primary} disabled={busy || name.trim() === ''}>
          {t('form.add')}
        </button>
      </form>
    </section>
  )
}
