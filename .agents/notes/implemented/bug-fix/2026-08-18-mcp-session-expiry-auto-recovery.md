# Agent Note: MCP client auto-recovery from lapsed remote sessions

Status: implemented

English | [中文](2026-08-18-mcp-session-expiry-auto-recovery.zh.md)

## Problem

A bound Streamable HTTP MCP server whose gateway expires sessions becomes permanently unusable until a human re-binds it. Observed on the ModelScope 12306 gateway: after a server-side timeout, every `tools/call` came back with `Code: SessionExpired` describing the same dead `mcp-session-id`, repeatedly, for the rest of the conversation.

The [auto-reconnect supervisor](../feature/2026-08-06-mcp-client-auto-reconnect.md) cannot recover this by design. The SDK's `StreamableHTTPClientTransport` holds one session id for the life of the transport and resends it on every request; it fires `onclose` only for deliberate closes, and the server's refusal surfaces as a per-request error. Since transport close is the single reconnect trigger, the supervisor correctly believes the connection is healthy and never negotiates a new session. The refused call is surfaced to the model as an opaque `Error POSTing to endpoint … SessionExpired`, and the only way out is re-binding the server in the MCP dock — which mounts a fresh mcp-client fiber and renegotiates.

## Decision

The tool bridge classifies a narrow, provable failure at the wire boundary and routes it into the existing supervisor path. When a `tools/call` rejection names a lapsed remote session, the executor fires an `onSessionInvalid` callback on `ToolBridgeOptions` and rethrows the original error; the supervisor closes the current generation in response, and its onclose drives the already-idempotent reconnect loop, whose fresh transport negotiates a new session id. The model still sees the original call error — recovery happens behind the turn and costs one backoff interval rather than the dead session being replayed.

The classifier matches a deliberately short marker list over the stringified `cause` chain (the SDK wraps a gateway's JSON-RPC payload in an English sentence, possibly nesting the original): the Streamable HTTP spec's session-fault vocabulary (`MCP-Server-Session-Not-Valid`, invalid `mcp-session-id` header) and the observed ModelScope payload (`SessionExpired`, "session … is expired"). Matching is narrow on purpose: general per-request failures must not tear down a healthy connection — the original note's rejection stays true for them.

This partially supersedes the rejected "Route Streamable HTTP request failures into the supervisor" alternative in the auto-reconnect note. The harness still cannot, and does not, treat arbitrary request failures as deaths; the one exception is the lapsed-session class, where renegotiation is provably required.

## Alternatives considered

- **Classifying any Streamable HTTP request failure into the supervisor.** The old note's rejection stands: per-request failures do not imply a dead server, and generation churn on transient outages costs a backoff interval for nothing.
- **Re-initializing inside the transport.** The SDK owns the session id and gives no renegotiate hook that the harness could drive reliably; generation teardown reuses the supervisor's tested close-onclose-reconnect path.
- **Only telling the model to ask the user to re-bind.** That is the manual workaround, returns nothing by itself, and depends on model cooperation — acceptable as a human fallback, not as the recovery mechanism.

## Consequences

- A bound Streamable HTTP server whose session lapses recovers automatically after one backoff interval (default first delay 500 ms). The failing turn still reports an error; the next one succeeds.
- HTTP servers remain outside supervisor restarts for every other failure class, per the original note; this is one documented exception.
- `ToolBridgeOptions` gains an optional `onSessionInvalid` callback (default none) — an internal contract between the bridge and the supervisor, not user configuration.

## Testing

Unit tests in `packages/mcp/mcp-client/tests/mcp-client.spec.ts` pin both sides of the classifier with the mock `callTool` rejecting: the observed ModelScope `SessionExpired` payload fires `onSessionInvalid` exactly once while still yielding an `isError` call result, and an ordinary upstream failure does not fire it. The supervisor-side wiring (close → onclose → reconnect) is the transport-close path already covered by `reconnect.spec.ts`. No snapshot: the change adds no model-visible presentation, and the failing call still traces the same error text as before recovery.