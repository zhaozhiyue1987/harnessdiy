/** Invariant companion for the TraceTelemetry Service Definition. @module @deepseek-ai/dsh-telemetry/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-telemetry'

/** Cordis companion plugin name. */
export const name = 'telemetry-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** The Service Definition holds no durable session state to validate. */
const install: InvariantInstaller = () => {}

/** Register the package ownership companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
