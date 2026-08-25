/** Invariant companion for the Trace Query provider. @module @deepseek-ai/dsh-gateway-trace-query/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-gateway-trace-query'

/** Cordis companion plugin name. */
export const name = 'gateway-trace-query-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** The Service Definition owns durable association validation. */
const install: InvariantInstaller = () => {}

/** Register the package ownership companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
