/** Ownership companion for the Higress Trace composition bundle. @module @deepseek-ai/dsh-higress-trace/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-higress-trace'

/** Cordis companion plugin name. */
export const name = 'higress-trace-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']
/** The mounted service packages own their own runtime relations. */
const install: InvariantInstaller = () => {}
/** Register the bundle ownership companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
