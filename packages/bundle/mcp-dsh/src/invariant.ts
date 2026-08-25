/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp`.
 * @module @deepseek-ai/dsh-mcp/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp'

/** Cordis companion plugin name. */
export const name = 'mcp-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the patch layer is purely composition — it inserts
 * `mcp-manager` into the loader tree, and that plugin owns its own observable
 * contracts. The bundle registers nothing and holds no mutable relation to
 * audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
