/**
 * Browser-local object layer over the mcp-manager Remote. One observable per
 * surface: the root-scoped catalog controller backs the settings section, and
 * one session controller per Session backs the input dock. Remote calls wrap
 * every business result in {@link RemoteResult}, so failures arrive as the
 * `ok: false` branch rather than a rejection.
 * @module @deepseek-ai/dsh-client-ui-mcp/client/controller
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  McpBindRequest,
  McpBindResult,
  McpBoundResult,
  McpBoundServer,
  McpCatalog,
  McpManagerFailure,
  McpManagerResult,
  McpRemoveRequest,
  McpRemoveResult,
  McpServerSpec,
  McpServerToolsRequest,
  McpServerToolsResult,
  McpUnbindRequest,
  McpUnbindResult,
  McpUpsertRequest,
  McpUpsertResult,
} from '@deepseek-ai/dsh-mcp-manager/types'

/**
 * The generated Remote namespace this plugin drives. Every business method
 * returns `McpManagerResult<T>` and Typert wraps it in the wire layer
 * `RemoteResult<...>`, so a call settles in two discriminators: the wire
 * `ok` first, then the manager's own `ok` inside `value`.
 */
export interface McpManagerRemote {
  list: () => Promise<RemoteResult<McpManagerResult<McpCatalog>>>
  upsert: (request: McpUpsertRequest) => Promise<RemoteResult<McpUpsertResult>>
  deleteServer: (request: McpRemoveRequest) => Promise<RemoteResult<McpRemoveResult>>
  bound: (agentId: SessionId) => Promise<RemoteResult<McpBoundResult>>
  bind: (agentId: SessionId, request: McpBindRequest) => Promise<RemoteResult<McpBindResult>>
  unbind: (agentId: SessionId, request: McpUnbindRequest) => Promise<RemoteResult<McpUnbindResult>>
  serverTools: (request: McpServerToolsRequest) => Promise<RemoteResult<McpServerToolsResult>>
}

/** Load state shared by every controller. */
export type McpLoadStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Settled mutation outcome shown by a control. */
export type McpActionResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

/** Base observable: one subscribe/getSnapshot pair plus an action carrier. */
function describe(code: string): string {
  switch (code) {
    case 'unknown-server': return 'this server is no longer configured'
    case 'already-bound': return 'this server is already bound to the session'
    case 'not-bound': return 'this server is not bound to the session'
    case 'bind-failed': return 'the server could not start in this session'
    case 'invalid-spec': return 'the server definition is incomplete or invalid'
    case 'settings-unavailable': return 'the persistent catalog is unavailable'
    default: return code
  }
}

/** Catalog view rendered by the settings section. */
export interface McpCatalogView {
  status: McpLoadStatus
  error: string | null
  servers: McpServerSpec[]
  /** Cached tool counts keyed by server name; `null` means not yet fetched. */
  toolCounts: ReadonlyMap<string, number>
}

/** One session's bindings, rendering chip state in the input dock. */
export interface McpSessionView {
  status: McpLoadStatus
  error: string | null
  servers: McpBoundServer[]
  catalog: McpServerSpec[]
}

const COLD_CATALOG: McpCatalogView = Object.freeze({ status: 'cold', error: null, servers: [], toolCounts: new Map() })

const COLD_SESSION: McpSessionView = Object.freeze({ status: 'cold', error: null, servers: [], catalog: [] })

const OK: McpActionResult = Object.freeze({ ok: true })

/**
 * Message of a failed layer — either the wire `error` carrier or the
 * manager's own `message` carrier; the plain `in` checks narrow each union.
 */
function failureText(r: RemoteResult<unknown> | McpManagerFailure): string {
  return 'error' in r ? r.error.message : 'message' in r ? r.message : ''
}

/** Root-scoped catalog controller (the settings section). */
export class McpCatalogController {
  private view: McpCatalogView = COLD_CATALOG
  private listeners = new Set<() => void>()
  private tail = Promise.resolve()
  private loaded = false

  constructor(private readonly remote: McpManagerRemote) {}

  /**
   * The current catalog view, ready after the first successful load.
   * @returns The latest catalog snapshot.
   */
  getSnapshot(): McpCatalogView {
    return this.view
  }

  /**
   * Runs the listener on every catalog change.
   * @param listener - The subscription callback invoked on each change.
   * @returns A removal function for this subscription.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(next: McpCatalogView): void {
    this.view = next
    for (const listener of this.listeners) listener()
  }

  /** Load the catalog once; later calls reload it. */
  load(): void {
    if (this.view.status === 'loading') return
    this.publish({ status: 'loading', error: null, servers: this.view.servers, toolCounts: this.view.toolCounts })
    void (async () => {
      const result = await this.remote.list()
      if (result.ok && result.value.ok) {
        this.loaded = true
        this.publish({ status: 'ready', error: null, servers: result.value.value.servers, toolCounts: this.view.toolCounts })
      } else {
        this.publish({ status: 'error', error: failureText(result), servers: this.view.servers, toolCounts: this.view.toolCounts })
      }
    })()
  }

  /** Re-read only when a previous load already succeeded (transient resets). */
  resync(): void {
    if (this.loaded) this.load()
  }

  /**
   * Fetch the tool count for one catalog server. Connects to the server,
   * lists its tools, then disconnects. Updates the cached toolCounts map.
   * @param serverName - The catalog name of the server to query.
   * @returns The action outcome.
   */
  async fetchToolCount(serverName: string): Promise<McpActionResult> {
    const result = await this.remote.serverTools({ serverName })
    if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message }
    if (!result.value.ok) return { ok: false, code: result.value.code, message: result.value.message }
    const counts = new Map(this.view.toolCounts)
    counts.set(serverName, result.value.value.toolsCount)
    this.publish({ ...this.view, toolCounts: counts })
    return OK
  }

  /**
   * Add or replace one server; reloads the catalog on success.
   * @param server - The full spec to upsert into the managed catalog.
   * @returns The action outcome.
   */
  async upsert(server: McpServerSpec): Promise<McpActionResult> {
    const result = await this.remote.upsert({ server })
    if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message }
    this.tail = this.tail
      .then(() => this.remote.list())
      .then((reloaded) => {
        if (reloaded.ok && reloaded.value.ok) {
          this.publish({ status: 'ready', error: null, servers: reloaded.value.value.servers, toolCounts: this.view.toolCounts })
        }
      })
      .catch(() => { /* reload failure keeps the last good view */ })
    await this.tail
    return OK
  }

  /**
   * Remove one server; reloads the catalog on success.
   * @param serverName - The catalog name of the server to remove.
   * @returns The action outcome.
   */
  async deleteServer(serverName: string): Promise<McpActionResult> {
    const result = await this.remote.deleteServer({ serverName })
    if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message }
    const counts = new Map(this.view.toolCounts)
    counts.delete(serverName)
    this.publish({ status: 'ready', error: null, servers: this.view.servers.filter(s => s.serverName !== serverName), toolCounts: counts })
    return OK
  }
}

/** Session-scoped bindings controller (the input dock). */
export class McpSessionController {
  private view: McpSessionView = COLD_SESSION
  private listeners = new Set<() => void>()
  private loaded = false

  constructor(
    private readonly remote: McpManagerRemote,
    private readonly sessionId: SessionId,
  ) {}

  /**
   * The current session-bindings view, ready after the first successful load.
   * @returns The latest bindings snapshot.
   */
  getSnapshot(): McpSessionView {
    return this.view
  }

  /**
   * Runs the listener on every bindings change.
   * @param listener - The subscription callback invoked on each change.
   * @returns A removal function for this subscription.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(next: McpSessionView): void {
    this.view = next
    for (const listener of this.listeners) listener()
  }

  /** Ensure one initial load, then reload on later taps. */
  load(): void {
    if (this.view.status === 'loading') return
    this.publish({ status: 'loading', error: null, servers: this.view.servers, catalog: this.view.catalog })
    void (async () => {
      const boundResult = await this.remote.bound(this.sessionId)
      const catalogResult = await this.remote.list()
      if (catalogResult.ok && catalogResult.value.ok && boundResult.ok && boundResult.value.ok) {
        this.loaded = true
        this.publish({
          status: 'ready', error: null,
          servers: boundResult.value.value.servers, catalog: catalogResult.value.value.servers,
        })
      } else {
        // Prefer the manager's own failure detail over a wire-level failure.
        const failed = boundResult.ok && !boundResult.value.ok ? boundResult.value : catalogResult
        this.publish({ status: 'error', error: failureText(failed), servers: this.view.servers, catalog: this.view.catalog })
      }
    })()
  }

  /** Re-read only when a previous load already succeeded (transient resets). */
  resync(): void {
    if (this.loaded) this.load()
  }

  /**
   * Bind one catalog server; reloads bindings on success.
   * @param serverName - The catalog name of the server to bind.
   * @returns The action outcome.
   */
  async bind(serverName: string): Promise<McpActionResult> {
    const result = await this.remote.bind(this.sessionId, { serverName })
    if (!result.ok) {
      return { ok: false, code: result.error.code, message: describe(result.error.code) || result.error.message }
    }
    this.load()
    return OK
  }

  /**
   * Unbind one bound server; reloads bindings on success.
   * @param serverName - The catalog name of the server to unbind.
   * @returns The action outcome.
   */
  async unbind(serverName: string): Promise<McpActionResult> {
    const result = await this.remote.unbind(this.sessionId, { serverName })
    if (!result.ok) {
      return { ok: false, code: result.error.code, message: describe(result.error.code) || result.error.message }
    }
    this.load()
    return OK
  }
}
