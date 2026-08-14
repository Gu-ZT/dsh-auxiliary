/**
 * Approval-reviewer routing: a hookup for dsh-command-approve-for-me.
 *
 * When the approve-for-me plugin is installed and its `mode: review` is active,
 * it asks a reviewer model to decide each approval prompt. By default the
 * reviewer inherits the requesting session's model route, and the plugin offers
 * its own `reviewProvider` / `reviewModel` config — but both are owned by that
 * plugin. This module lets dsh-auxiliary provide a dedicated approval model
 * instead: a listener on the official `llm/stream` waterfall recognizes the
 * plugin's review call and reroutes it to `approve.provider` / `approve.model`.
 *
 * Recognition uses only the plugin's public output contract, so it stays
 * correct across versions: the review user prompt is the fixed marker
 * `>>> APPROVAL REQUEST START` (see the plugin's `renderReviewUserPrompt`), the
 * call carries no `sessionId` (it is not an agent-loop request), and it always
 * runs at `temperature: 0`. No other caller in the harness matches all three.
 *
 * Like the image-handoff listener, the reroute vetoes the chain and re-enters
 * the waterfall with a synchronous guard. The rewritten request intentionally
 * is NOT `markAgentLoopRequest`-marked, so the agent-loop invariant (which only
 * audits marked requests) skips it — matching the original call, which was
 * never marked either.
 *
 * @module dsh-auxiliary/approve-router
 */
import type { Context } from '@deepseek-ai/cordis';
import { deepFreeze, type GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { ResolvedPluginConfig } from './config.js';

/** The approve-for-me review prompt's fixed action marker. */
const APPROVAL_REQUEST_MARKER = '>>> APPROVAL REQUEST START';

/**
 * Whether one `llm/stream` request is the approve-for-me plugin's review call.
 *
 * @param options - the request as observed at the waterfall.
 */
export function isApproveReviewCall(options: GenerateOptions): boolean {
  if (options.sessionId !== undefined) return false;
  if (options.temperature !== 0) return false;
  if (options.system === undefined) return false;
  return options.messages.some((message) =>
    message.role === 'user'
    && Array.isArray(message.content)
    && message.content.some((block) =>
      block.type === 'text'
      && block.text.includes(APPROVAL_REQUEST_MARKER)
    )
  );
}

/**
 * Install the approval-reviewer routing listener. Returns a disposer that
 * removes the listener.
 *
 * The routing only activates while `approve.enabled` is true and a full
 * provider/model route is selected; without the approve-for-me plugin there are
 * no review calls to match, so the listener is inert.
 *
 * @param ctx - the plugin context with the `llm` service.
 * @param get - current resolved plugin config snapshot.
 */
export function registerApproveRouter(ctx: Context, get: () => ResolvedPluginConfig): () => void {
  const enabled = (): boolean => {
    const approve = get().approve;
    return approve.enabled && approve.provider !== undefined && approve.model !== undefined;
  };

  // Re-entrancy guard: the rerouted dispatch re-enters this listener once.
  let active = false;
  const disposeListener = ctx.on('llm/stream', (options, next) => {
    if (active) return next();
    if (!enabled()) return next();
    const approve = get().approve;
    if (approve.provider === undefined || approve.model === undefined) return next();
    if (!isApproveReviewCall(options)) return next();
    if (options.provider === approve.provider && options.model === approve.model) return next();
    const rewritten = deepFreeze({ ...options, provider: approve.provider, model: approve.model });
    active = true;
    try {
      return ctx.llm.stream(rewritten);
    } finally {
      active = false;
    }
  });

  return () => {
    disposeListener();
  };
}
