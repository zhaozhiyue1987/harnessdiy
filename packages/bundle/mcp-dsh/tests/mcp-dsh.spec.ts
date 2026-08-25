/**
 * The mcp-dsh bundle's patch layer inserts one row (mcp-manager) whose
 * composition contract is covered by its own package. This test verifies the
 * bundle's invariant companion registers and disposes correctly.
 */

import { Context } from '@deepseek-ai/cordis'
import InvariantService from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import { apply, name, inject } from '../src/invariant.ts'

describe('mcp-dsh invariant companion', () => {
  it('registers and disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService)
    await ctx.plugin({ name, inject, apply })
    const invariants = ctx.get('invariants')
    expect(invariants).toBeDefined()
    await ctx.fiber.dispose()
  })
})
