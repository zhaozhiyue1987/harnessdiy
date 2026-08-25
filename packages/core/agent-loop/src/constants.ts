/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Default platform identifier written as the `X-Agent-Platform` gateway business header. */
export const DEFAULT_AGENT_PLATFORM = 'deepseek-harness'
