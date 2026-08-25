/**
 * Client-safe data contracts shared by the mcp-manager Remote service and the
 * ui-mcp client bundle. Values cross the Typert wire as JSON, so every field
 * is plain and serializable; the host normalizes a {@link McpServerSpec} into
 * a resolved mcp-client plugin config at bind time.
 *
 * @module
 */

/** Transport selector for one managed MCP server. */
export type McpTransport = 'stdio' | 'streamable-http' | 'sse'

/** Automatic reconnect policy for bound sessions (mirrors mcp-client defaults). */
export interface McpReconnectSpec {
  /** Reconnect automatically after a lost connection. */
  enabled?: boolean
  /** First reconnect delay in milliseconds; doubles per consecutive failed attempt. */
  initialDelayMs?: number
  /** Backoff ceiling in milliseconds; also the uptime after which the attempt budget resets. */
  maxDelayMs?: number
  /** Consecutive failed attempts per outage before giving up for good. */
  maxAttempts?: number
}

/**
 * One managed MCP server entry, as persisted in the mcp-manager settings
 * section. `serverName` is both the stable identity and the name shown in
 * UIs; optional fields fall back to mcp-client defaults on bind.
 */
export interface McpServerSpec {
  /** Stable identity and display name; `[A-Za-z0-9_-]{1,32}`. */
  serverName: string
  /** Transport selector for the connection. */
  transport: McpTransport
  /** Streamable HTTP or SSE endpoint URL (required for those transports). */
  url?: string
  /** Request headers for the Streamable HTTP / SSE transports, e.g. Authorization. */
  headers?: Record<string, string>
  /** Stdio transport: the command to spawn (required for that transport). */
  command?: string
  /** Stdio transport: additional command arguments. */
  args?: string[]
  /** Stdio transport: environment overrides. */
  env?: Record<string, string>
  /** Stdio transport: working directory. */
  cwd?: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs?: number
  /** Fail the session bind when the initial connection or tool sync fails. */
  failOnStartupError?: boolean
  /** Reconnect policy overrides; omission uses mcp-client defaults. */
  reconnect?: McpReconnectSpec
}

/** Catalog of every managed MCP server. */
export interface McpCatalogValue {
  servers: McpServerSpec[]
}

/**
 * A {@link McpServerSpec} after `resolveSpec` has pinned every default: the
 * persisted catalog form and the exact contract `toClientConfig` translates.
 * Each member carries only the fields its transport uses, all required.
 */
export type ResolvedMcpServerSpec = (
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string }
  | { transport: 'streamable-http'; url: string; headers: Record<string, string> }
  | { transport: 'sse'; url: string; headers: Record<string, string> }
) & {
  serverName: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: Required<McpReconnectSpec>
}

/** Client-safe projection of one tool the bound MCP server advertises. */
export interface McpToolInfo {
  /** The tool name exactly as the server advertises it. */
  rawName: string
  /** The model-facing name registered in this session (`mcp__<instance>__<raw>`). */
  publicName: string
  description: string
  /** The JSON schema the server advertises for `tools/call` arguments. */
  inputSchema: McpInputSchema
}

/**
 * Arbitrary JSON admissible across a Remote boundary: the tool argument
 * schema is server-authored, so only a recursive JSON shape can carry it.
 * The Typert wire forbids bare `unknown`/`any` at the boundary.
 */
export type McpInputSchema =
  | null
  | boolean
  | number
  | string
  | McpInputSchema[]
  | { [key: string]: McpInputSchema }

/** One MCP server bound to the current session. */
export interface McpBoundServer {
  /** The catalog `serverName` this binding was created from. */
  serverName: string
  /** The unique instance namespace actually mounted in this session. */
  instanceName: string
  /** The server's current tool inventory as the connection reports it. */
  tools: McpToolInfo[]
}

/** Explicit business failures returned by the mcp-manager Remote methods. */
export type McpErrorCode =
  | 'invalid-server-name'
  | 'invalid-spec'
  | 'duplicate-server'
  | 'unknown-server'
  | 'already-bound'
  | 'not-bound'
  | 'bind-failed'
  | 'settings-unavailable'
  | 'internal'

/** Success carrier: `ok: true` plus the typed value. */
export type McpManagerOk<T> = { ok: true; value: T }

/** Failure carrier: `ok: false` with an explicit code and human message. */
export type McpManagerFailure = { ok: false; code: McpErrorCode; message: string }

/** Sealed remote result: either the value or one explicit business failure. */
export type McpManagerResult<T> = McpManagerOk<T> | McpManagerFailure

/** List the managed server catalog. */
export type McpCatalog = McpCatalogValue

/** Add or replace one managed server. */
export interface McpUpsertRequest {
  server: McpServerSpec
}

/** Result of upserting one managed server. */
export type McpUpsertResult = McpManagerResult<McpServerSpec>

/** Remove one managed server and unbind it everywhere. */
export interface McpRemoveRequest {
  serverName: string
}

/** Result of removing one managed server. */
export type McpRemoveResult = McpManagerResult<{ serverName: string }>

/** Result of listing the MCP servers bound to this session. */
export type McpBoundResult = McpManagerResult<{ servers: McpBoundServer[] }>

/** Bind one managed server to this session. */
export interface McpBindRequest {
  serverName: string
}

/** Result of binding one managed server to this session. */
export type McpBindResult = McpManagerResult<McpBoundServer>

/** Unbind one managed server from this session. */
export interface McpUnbindRequest {
  serverName: string
}

/** The result of unbinding a server from a session. */
export type McpUnbindResult = McpManagerResult<{ serverName: string }>

/** Query one managed server and return its current tool list. */
export interface McpServerToolsRequest {
  serverName: string
}

/** Result of querying one server's tools. */
export type McpServerToolsResult = McpManagerResult<{ serverName: string; toolsCount: number }>

/**
 * Build the success carrier for a typed value.
 * @param value - The typed value carried by the result.
 * @returns The success carrier with the given value.
 */
export function ok<T>(value: T): McpManagerOk<T> {
  return { ok: true, value }
}

/**
 * Build a failure carrier with an explicit code and human message.
 * @param code - The business failure code carried to Remote callers.
 * @param message - Human-readable reason for the failure.
 * @returns The failure carrier.
 */
export function rejected(code: McpErrorCode, message: string): McpManagerFailure {
  return { ok: false, code, message }
}
