/**
 * MCP management plugin, browser half: the MCP servers settings section plus
 * the per-session bind dock above the input area. One catalog controller
 * backs the section; one session controller per Session backs dock chips, so
 * a bind/bound read cycles exactly once per active surface.
 * @module @deepseek-ai/dsh-client-ui-mcp/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.remote merge (mcpManager) through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-settings SlotMap merge (the settings.section entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { McpCatalogController, McpSessionController } from './controller.ts'
import { McpSettingsSection } from './McpSettingsSection.tsx'
import type { McpSettingsSectionInjected } from './McpSettingsSection.tsx'
import { McpDock } from './McpDock.tsx'
import type { McpDockInjected } from './McpDock.tsx'
import { en, zh } from './locales.ts'
import type { McpKey } from './locales.ts'

export type {
  McpActionResult, McpCatalogView, McpManagerRemote, McpSessionView, McpCatalogController, McpSessionController,
} from './controller.ts'
export type { McpSettingsSectionInjected, McpSettingsSectionProps } from './McpSettingsSection.tsx'
export type { McpDockInjected, McpDockProps } from './McpDock.tsx'
export type { McpKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The MCP settings page + input dock copy. */
    mcp: McpKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'mcp'

/** Required services: the slot registry, the Remote namespace, and the copy. */
export const inject = ['slots', 'remote', 'remote.mcpManager', 'locale']

/**
 * Client plugin body: the MCP catalog section and the per-session dock.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mcp: dictionaries')

  const remote = ctx.remote.mcpManager
  const catalog = new McpCatalogController(remote)
  const sections = new Map<SessionId, McpSessionController>()
  const sectionFor = (sessionId: SessionId): McpSessionController => {
    let controller = sections.get(sessionId)
    if (controller === undefined) {
      controller = new McpSessionController(remote, sessionId)
      sections.set(sessionId, controller)
    }
    return controller
  }
  const t = ctx.locale.bind(NS)

  // A reconnect can only invalidate what was already read; a cold surface
  // stays cold until something asks for it.
  ctx.on('connection/reset', () => {
    catalog.resync()
    for (const controller of sections.values()) controller.resync()
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp',
    order: 40,
    label: () => t('nav'),
    inject: (): McpSettingsSectionInjected => ({ controller: catalog, t }),
  }, McpSettingsSection))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mcp',
    order: 30,
    locale: NS,
    inject: (sessionId: SessionId): McpDockInjected => ({
      controller: sectionFor(sessionId),
    }),
  }, McpDock))
}

/** Re-export data contracts the fixture graph types against. */
export type { McpActionResult as McpAction } from './controller.ts'
