import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SettingsProvider, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import McpManagerService from '../src/index.ts'
import * as McpManagerInvariant from '../src/invariant.ts'

/** In-memory settings provider, mirroring the settings package's BareProvider. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

describe('mcp-manager invariant companion', () => {
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(McpManagerService)
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(McpManagerInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-mcp-manager', () => {})
    }).toThrow(/already registered/u)

    await fiber.dispose()
    await expect(ctx.plugin(McpManagerInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
