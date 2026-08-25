/** Package-owned invariant companion for the Console gateway-trace provider. @module @deepseek-ai/dsh-gateway-trace-console/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-gateway-trace-console'

/** Cordis companion plugin name. */
export const name = 'gateway-trace-console-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: gateway-trace owns the durable anchor relation; this provider owns only transport and scheduling. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
