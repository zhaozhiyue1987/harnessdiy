/** Trajectory Consumer for durable gateway observability records. */

import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-gateway-trace/types'
import { trajectoryNode } from './trajectory-definition-common.ts'
import type { TrajectoryGatewayTrace } from './trajectory-contract.ts'

/** Fold one gateway observation into the trajectory snapshot at its source step. */
const trajectoryGatewayTraceDefinition: ConversationNodeDefinition<TrajectoryGatewayTrace> = {
  kind: 'trajectory-gateway-trace',
  target: 'trajectory',
  match: event => event.type === 'gateway/trace'
    ? { id: event.data.requestId ?? event.data.traceId, role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'gateway/trace') {
      throw new Error('trajectory-gateway-trace start requires gateway/trace')
    }
    return match.event.data
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined ? null : trajectoryNode(
    context,
    context.matches.at(-1)?.event.seq ?? 0,
    { kind: 'gateway-trace', trace: context.state },
  ),
}

/**
 * Register the gateway-observation Consumer.
 * @param ctx - Client context receiving the Conversation node definition.
 */
export function registerTrajectoryGatewayTraceDefinition(ctx: Context): void {
  ctx.conversationEvents.register(trajectoryGatewayTraceDefinition)
}
