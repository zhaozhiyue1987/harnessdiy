/** Console-provider configuration vocabulary. @module @deepseek-ai/dsh-gateway-trace-console/types */

/** Retry policy for eventual consistency between the data plane and Console. */
export interface GatewayTraceRetry {
  /** Maximum reverse-query attempts for one response correlation. */
  maxRetries?: number
  /** Initial retry delay in milliseconds. */
  initialDelayMs?: number
  /** Largest retry delay in milliseconds. */
  maxDelayMs?: number
  /** Maximum background reverse queries running at once. */
  maxConcurrentQueries?: number
}

/** Local, trusted-service provider configuration for Higress Console. */
export interface GatewayTraceConsoleConfig {
  /** Base URL of Higress Console, which serves `/v1/observability/*`. */
  consoleBaseUrl: string
  /** Credential reference resolving to the Console HTTP Basic username. */
  basicUsernameRef?: string
  /** Credential reference resolving to the Console HTTP Basic password. */
  basicPasswordRef?: string
  /** Enable automatic background reflection from response-correlated stages. */
  reflect?: boolean
  /** Configurable retry policy for transient Console/data-plane lag. */
  retry?: GatewayTraceRetry
}

/** Resolved immutable provider configuration. */
export interface ResolvedGatewayTraceConsoleConfig {
  /** Canonical trailing-slash Console URL for endpoint construction. */
  consoleBaseUrl: URL
  /** Basic username credential, absent when querying is disabled. */
  basicUsernameRef?: import('@deepseek-ai/dsh-credentials').CredentialRef
  /** Basic password credential, absent when querying is disabled. */
  basicPasswordRef?: import('@deepseek-ai/dsh-credentials').CredentialRef
  /** Whether new response-correlated stages are reflected in the background. */
  reflect: boolean
  /** Fully materialized retry policy. */
  retry: Required<GatewayTraceRetry>
}
