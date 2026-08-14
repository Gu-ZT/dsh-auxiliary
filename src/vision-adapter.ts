/**
 * OpenAI-compatible vision adapter for the DeepSeek Harness LLM seam.
 *
 * Implements {@link LlmAdapter} for the `aux-vision` provider route: it
 * streams chat completions from any OpenAI-compatible endpoint and accepts
 * harness `image` content blocks (resolved through the injected attachment
 * reader), so a text-only main model can delegate image understanding to a
 * vision-capable auxiliary model — both for the `inspect_image` tool and for
 * compaction summaries over image-bearing history.
 *
 * @module dsh-auxiliary/vision-adapter
 */
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  attributionHeaders,
  isContextWindowExceededError,
  isQuotaExceededError,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type ProviderRequestId,
  type ResolvedRetryPolicy,
  type StreamChunk,
  type TokenUsage
} from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment';
import { idleWatchdog, timeoutOf, type IdleWatchdog } from '@deepseek-ai/dsh-timeout';
import { toWireMessages, type WireMessage } from './openai-wire.js';
import { parseSse, type SseEvent } from './sse.js';

/** Stable provider route owned by this adapter. */
export const VISION_PROVIDER = 'aux-vision';

/** Timeout code stamped on stream-idle aborts. */
const STREAM_IDLE_TIMEOUT_CODE = 'AUX_VISION_STREAM_IDLE_TIMEOUT';

/** One entry of the advisory vision model catalog. */
export interface VisionModelEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

/** Resolved, validated connection facts for one vision provider route. */
export interface ResolvedVisionOptions {
  readonly baseURL: string;
  readonly model: string;
  readonly models: readonly VisionModelEntry[];
  readonly maxTokens: number;
  readonly defaultContextWindow: number;
  readonly streamIdleTimeoutMs: number;
  readonly retryPolicy: ResolvedRetryPolicy;
}

/** Constructor dependencies injected by the plugin (config, credentials, attachments). */
export interface VisionAdapterDeps {
  /** Resolve the current connection facts; re-read for every request. */
  options: () => ResolvedVisionOptions;
  /** Resolve a usable API key for the configured credential reference. */
  resolveApiKey: () => Promise<string>;
  /** Read verified bytes for one durable image reference. */
  readImage: (ref: ImageAttachmentRef) => Promise<StoredImageAttachment>;
}

/** The default catalog entry for the configured primary model. */
function defaultEntry(options: ResolvedVisionOptions): VisionModelEntry {
  return {
    id: options.model,
    name: options.model,
    contextWindow: options.defaultContextWindow,
    maxTokens: options.maxTokens
  };
}

/** Catalog entries in stable order, deduplicated by id (catalog wins over the default entry). */
function catalogEntries(options: ResolvedVisionOptions): readonly VisionModelEntry[] {
  const seen = new Set<string>();
  const entries: VisionModelEntry[] = [];
  for (const entry of [defaultEntry(options), ...options.models]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

/** Map one OpenAI finish reason to the harness vocabulary. */
function mapFinishReason(reason: string): 'stop' | 'max-tokens' | 'tool-calls' {
  switch (reason) {
    case 'length':
      return 'max-tokens';
    case 'tool_calls':
      return 'tool-calls';
    default:
      return 'stop';
  }
}

/** Normalize OpenAI usage into the disjoint harness token vocabulary. */
function normalizeUsage(usage: Record<string, unknown>): TokenUsage {
  const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
  const details = usage.prompt_tokens_details as { cached_tokens?: unknown } | undefined;
  const cached = typeof details?.cached_tokens === 'number'
    ? details.cached_tokens
    : typeof usage.prompt_cache_hit_tokens === 'number'
      ? usage.prompt_cache_hit_tokens
      : 0;
  const inputTokens = Math.max(0, prompt - cached);
  return {
    inputTokens,
    outputTokens: completion,
    ...(cached > 0 ? { cacheReadTokens: cached } : {})
  };
}

/** Parse a `Retry-After` header into bounded milliseconds. */
function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.ceil(seconds * 1000), 60_000);
}

/** Stable provider-neutral error code for one HTTP status and detail. */
function httpErrorCode(status: number, detail: unknown): string {
  if (status === 401 || status === 403) return 'AUTH';
  const detailText = typeof detail === 'object' && detail !== null
    ? [String((detail as { code?: unknown }).code ?? ''), String((detail as { type?: unknown }).type ?? ''), String(((detail as { error?: { message?: unknown } }).error?.message) ?? ((detail as { message?: unknown }).message) ?? '')].filter(Boolean).join(' ')
    : String(detail ?? '');
  if (isQuotaExceededError(detailText)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return 'RATE_LIMIT';
  if (status === 400) {
    if (isContextWindowExceededError(detailText)) return CONTEXT_WINDOW_EXCEEDED_CODE;
    return 'INVALID_REQUEST';
  }
  if (status >= 500) return 'SERVER';
  return `HTTP_${status}`;
}

/** Best-effort JSON or text body of a failed response. */
async function readErrorDetail(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}

/** Throw the structured LlmError for a non-2xx provider response. */
function throwResponseError(response: Response, detail: unknown): never {
  const nested = typeof detail === 'object' && detail !== null ? (detail as { error?: { message?: unknown } }).error?.message : undefined;
  const providerMessage = typeof nested === 'string' && nested.length > 0
    ? nested
    : typeof detail === 'string' && detail.length > 0
      ? detail
      : `HTTP ${response.status} ${response.statusText}`;
  const requestId = response.headers.get('x-request-id') ?? undefined;
  throw new LlmError(`Vision provider error (HTTP ${response.status}): ${providerMessage}`, httpErrorCode(response.status, detail), {
    status: response.status,
    ...(parseRetryAfterSeconds(response.headers.get('retry-after')) !== undefined
      ? { providerRetryAfterMs: parseRetryAfterSeconds(response.headers.get('retry-after')) }
      : {}),
    ...(requestId !== undefined ? { requestId: requestId as ProviderRequestId } : {})
  });
}

/**
 * Translate an SSE chat-completions stream into harness chunks. Emits a
 * `reasoning` block when the provider reports `reasoning_content`, then a
 * `text` block; a terminal error finish replaces a degenerate empty `stop`.
 */
async function* translateChatCompletions(
  events: AsyncGenerator<SseEvent>,
  watchdog: IdleWatchdog
): AsyncGenerator<StreamChunk> {
  const iterator = events[Symbol.asyncIterator]();
  let reasoningStarted = false;
  let textStarted = false;
  let reasoningText = '';
  let textText = '';
  let toolCallsSeen = false;
  let usage: TokenUsage | undefined;
  let wireFinish: 'stop' | 'max-tokens' | 'tool-calls' | undefined;

  for (;;) {
    const { done, value } = await watchdog.next(iterator);
    if (done) break;
    if (value.data === '[DONE]') break;
    let json: { usage?: Record<string, unknown>; choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: unknown }> };
    try {
      json = JSON.parse(value.data) as typeof json;
    } catch {
      continue;
    }
    if (json.usage !== undefined) usage = normalizeUsage(json.usage);
    const choice = json.choices?.[0];
    if (choice === undefined) continue;
    const delta = choice.delta ?? {};

    const reasoning = delta.reasoning_content;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      if (!reasoningStarted) {
        reasoningStarted = true;
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
      }
      reasoningText += reasoning;
      yield { type: 'reasoning-delta', index: 0, text: reasoning };
    }

    const text = delta.content;
    if (typeof text === 'string' && text.length > 0) {
      if (reasoningStarted) {
        reasoningStarted = false;
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoningText } };
      }
      if (!textStarted) {
        textStarted = true;
        yield { type: 'block-start', index: 1, blockType: 'text' };
      }
      textText += text;
      yield { type: 'text-delta', index: 1, text };
    }

    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) toolCallsSeen = true;
    if (typeof choice.finish_reason === 'string') wireFinish = mapFinishReason(choice.finish_reason);
  }

  if (reasoningStarted) {
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoningText } };
  }
  if (textStarted) {
    yield { type: 'block-end', index: 1, block: { type: 'text', text: textText } };
  }
  if (usage !== undefined) yield { type: 'usage', usage };

  const kind = wireFinish ?? (toolCallsSeen ? 'tool-calls' : textText.length > 0 ? 'stop' : undefined);
  if (kind === undefined || (kind === 'stop' && textText.length === 0 && !toolCallsSeen)) {
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'Vision provider returned an empty response (no content blocks)', code: EMPTY_RESPONSE_CODE }
      }
    };
    return;
  }
  yield { type: 'finish', reason: { kind } };
}

/**
 * OpenAI-compatible vision adapter: accepts harness text and image content,
 * streams chat completions, and reports text/reasoning output plus usage.
 */
export class VisionAdapter extends LlmAdapter {
  constructor(private readonly deps: VisionAdapterDeps) {
    super();
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Aux Vision (OpenAI-compatible)' };
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return this.deps.options().retryPolicy;
  }

  override async listModels(provider: string): Promise<LlmModelInfo[]> {
    return catalogEntries(this.deps.options()).map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name ?? entry.id,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      inputModalities: ['text', 'image']
    }));
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const options = this.deps.options();
    const entry = catalogEntries(options).find((candidate) => candidate.id === model);
    return {
      provider,
      id: model,
      name: entry?.name ?? model,
      ...(entry?.description !== undefined ? { description: entry.description } : {}),
      inputModalities: ['text', 'image'],
      context: { contextWindow: entry?.contextWindow ?? options.defaultContextWindow },
      defaultMaxTokens: entry?.maxTokens ?? options.maxTokens
    };
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const connection = this.deps.options();
    const apiKey = await this.deps.resolveApiKey();
    const wireMessages: WireMessage[] = await toWireMessages(options.messages, this.deps.readImage);

    const watchdog = idleWatchdog(options.signal, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE);
    const wireSignal = options.signal !== undefined && watchdog.signal !== undefined
      ? AbortSignal.any([options.signal, watchdog.signal])
      : options.signal ?? watchdog.signal;

    const body = {
      model: options.model,
      messages: wireMessages,
      stream: true,
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.stop !== undefined && options.stop.length > 0 ? { stop: options.stop } : {}),
      stream_options: { include_usage: true }
    };

    try {
      const url = `${connection.baseURL.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...attributionHeaders()
        },
        body: JSON.stringify(body),
        signal: wireSignal
      });
      if (!response.ok) throwResponseError(response, await readErrorDetail(response));
      if (response.body === null) throw new LlmError('Vision provider returned no response body', 'EMPTY_RESPONSE');
      yield* translateChatCompletions(parseSse(response.body), watchdog);
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(`Vision stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, 'TIMEOUT');
      }
    } finally {
      watchdog[Symbol.dispose]();
    }
  }
}
