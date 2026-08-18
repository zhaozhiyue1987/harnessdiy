/** Package-owned invariant companion. @module @deepseek-ai/dsh-mcp-manager/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-manager'

/** Cordis companion plugin name. */
export const name = 'mcp-manager-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the single service owns both faces — the settings
 * section serializes the catalog and the private binding map tracks the
 * manager-created mcp-client fibers; no second authority pairs against them.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['mcpManager'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
