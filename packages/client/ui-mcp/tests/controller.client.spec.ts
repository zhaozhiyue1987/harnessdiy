import { describe, expect, it, vi } from 'vitest'
import { McpCatalogController, type McpManagerRemote } from '../src/client/controller.ts'

function remote(serverTools: McpManagerRemote['serverTools']): McpManagerRemote {
  return {
    list: vi.fn(),
    upsert: vi.fn(),
    deleteServer: vi.fn(),
    bound: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
    serverTools,
  }
}

describe('McpCatalogController tool count', () => {
  it('returns the manager failure so the UI can display the MCP error', async () => {
    const serverTools = vi.fn().mockResolvedValue({
      ok: true,
      value: { ok: false, code: 'bind-failed', message: 'MCP endpoint returned an empty response' },
    })
    const controller = new McpCatalogController(remote(serverTools))

    await expect(controller.fetchToolCount('12306')).resolves.toEqual({
      ok: false,
      code: 'bind-failed',
      message: 'MCP endpoint returned an empty response',
    })
    expect(controller.getSnapshot().toolCounts.has('12306')).toBe(false)
  })

  it('publishes the count only after a successful tools query', async () => {
    const serverTools = vi.fn().mockResolvedValue({
      ok: true,
      value: { ok: true, value: { serverName: '12306', toolsCount: 4 } },
    })
    const controller = new McpCatalogController(remote(serverTools))

    await expect(controller.fetchToolCount('12306')).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot().toolCounts.get('12306')).toBe(4)
  })
})
