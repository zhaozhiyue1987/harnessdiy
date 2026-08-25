/** Invariant companion for the OpenTelemetry trace provider. @module @deepseek-ai/dsh-telemetry-otel/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-telemetry-otel'

/** Cordis companion plugin name. */
export const name = 'telemetry-otel-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * The provider owns only transient async-local state and an external exporter;
 * neither has a durable relationship an invariant companion can inspect.
 */
const install: InvariantInstaller = () => {}

/** Register the package ownership companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
