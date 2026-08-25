import { Context } from '@deepseek-ai/cordis'
import InvariantService from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('higress-trace bundle invariant companion', () => {
  it('registers and disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService)
    await ctx.plugin({ name, inject, apply })
    expect(ctx.get('invariants')).toBeDefined()
    await ctx.fiber.dispose()
  })
})
