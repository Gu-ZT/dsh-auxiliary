/**
 * Plugin configuration: schemastery schema, runtime validation, and the
 * resolved snapshot consumed by every feature. The same schema backs the
 * `cordis.yml` entry and the optional `dsh-auxiliary` user-settings section,
 * so a settings change reaches the very next request.
 *
 * @module dsh-auxiliary/config
 */
import z from '@deepseek-ai/schemastery';
import { RetryPolicySchema, deepFreeze, resolveRetryPolicy, type ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import type { ResolvedVisionOptions, VisionModelEntry } from './vision-adapter.js';

/** Stable plugin id recorded with plugin-sourced messages and tool guidance. */
export const PLUGIN_NAME = 'dsh-auxiliary';

export const DEFAULT_VISION_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_VISION_API_KEY_ENV = 'VISION_API_KEY';
export const DEFAULT_VISION_MODEL = 'gpt-4o-mini';
export const DEFAULT_VISION_CONTEXT_WINDOW = 128000;
export const DEFAULT_VISION_MAX_TOKENS = 2048;
export const DEFAULT_VISION_STREAM_IDLE_TIMEOUT_MS = 300000;
export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_VISION_TOOL_TIMEOUT_MS = 120000;
export const DEFAULT_ENGINE_MAX_TOKENS = 8192;

/** The default compression instruction used by the optional engine. */
export const DEFAULT_COMPRESS_PROMPT = [
  'You are a context-compression engine for an AI coding assistant. Condense the conversation above into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below, keeping every section in order with terse bullets:',
  '- ## Primary Request and Intent (quote verbatim where wording matters)',
  '- ## Key Technical Concepts',
  '- ## Files and Code (exact paths, key changes or snippets)',
  '- ## Errors and Fixes',
  '- ## Pending Jobs',
  '- ## Current Work',
  '- ## Next Step (the single next action, or (none))',
  '- ## Critical Context (decisions, constraints, user preferences, open questions)',
  '',
  'Rules: preserve exact paths, commands, identifiers, numbers, and syntax fragments; capture user corrections faithfully; do not mention this compression request; output only the checkpoint text.'
].join('\n');

const visionModelSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1)
});

/** Plugin entry / settings schema. Field defaults live here so the UI can render them. */
const Config = z.object({
  vision: z.object({
    enabled: z.boolean().default(true),
    displayName: z.string().default('Aux Vision (OpenAI-compatible)'),
    baseURL: z.string().default(DEFAULT_VISION_BASE_URL),
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_VISION_API_KEY_ENV),
    model: z.string().default(DEFAULT_VISION_MODEL),
    models: z.array(visionModelSchema).default([]),
    maxTokens: z.number().step(1).min(1).default(DEFAULT_VISION_MAX_TOKENS),
    defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_VISION_CONTEXT_WINDOW),
    streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_VISION_STREAM_IDLE_TIMEOUT_MS),
    retryPolicy: RetryPolicySchema,
    provider: z.string().description('Reference an already-configured provider route (e.g. anvilcraft-ai). When set, vision calls route through that provider instead of the aux-vision custom endpoint.')
  }),
  tool: z.object({
    enabled: z.boolean().default(true),
    maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_VISION_TOOL_TIMEOUT_MS)
  }),
  compact: z.object({
    enabled: z.boolean().default(false),
    provider: z.string(),
    model: z.string()
  }),
  engine: z.object({
    enabled: z.boolean().default(false),
    thresholdRatio: z.number().step(0.01).min(0.01).max(0.99).default(0.8),
    retainRatio: z.number().step(0.01).min(0.01).max(0.99).default(0.16),
    maxTokens: z.number().step(1).min(1).default(DEFAULT_ENGINE_MAX_TOKENS),
    compactionRetries: z.number().step(1).min(0).default(1),
    maxOverflowRetries: z.number().step(1).min(0).default(1),
    auto: z.boolean().default(true),
    compressPrompt: z.string().default(DEFAULT_COMPRESS_PROMPT)
  })
});

/** Inferred plugin configuration value. */
export type PluginConfig = typeof Config extends z<infer T> ? T : never;

/** Resolved vision provider facts consumed by the adapter and the tool. */
export interface ResolvedVisionConfig extends ResolvedVisionOptions {
  readonly enabled: boolean;
  readonly displayName: string;
  readonly apiKeyEnv: string;
  /** Reference to an already-configured provider route; overrides the aux-vision custom endpoint. */
  readonly provider: string | undefined;
}

/** Resolved `inspect_image` tool policy. */
export interface ResolvedToolConfig {
  readonly enabled: boolean;
  readonly maxImageBytes: number;
  readonly timeoutMs: number;
}

/** Resolved compaction-routing policy (auxiliary summarizer route). */
export interface ResolvedCompactConfig {
  readonly enabled: boolean;
  readonly provider: string;
  readonly model: string;
}

/** Resolved auxiliary compression-engine policy. */
export interface ResolvedEngineConfig {
  readonly enabled: boolean;
  readonly thresholdRatio: number;
  readonly retainRatio: number;
  readonly maxTokens: number;
  readonly compactionRetries: number;
  readonly maxOverflowRetries: number;
  readonly auto: boolean;
  readonly compressPrompt: string;
}

/** The complete resolved, frozen plugin snapshot. */
export interface ResolvedPluginConfig {
  readonly vision: ResolvedVisionConfig;
  readonly tool: ResolvedToolConfig;
  readonly compact: ResolvedCompactConfig;
  readonly engine: ResolvedEngineConfig;
}

/** Normalize one advisory catalog entry (rejects empty ids and invalid numbers). */
function resolveModelEntry(entry: { id: string; name?: string; description?: string; contextWindow?: number; maxTokens?: number }, index: number): VisionModelEntry {
  if (entry.id.length === 0) throw new Error(`dsh-auxiliary: vision.models[${index}].id must be non-empty`);
  for (const key of ['name', 'description'] as const) {
    const value = entry[key];
    if (value !== undefined && value.length === 0) throw new Error(`dsh-auxiliary: vision.models[${index}].${key} must be non-empty when present`);
  }
  for (const key of ['contextWindow', 'maxTokens'] as const) {
    const value = entry[key];
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) throw new Error(`dsh-auxiliary: vision.models[${index}].${key} must be a positive integer`);
  }
  return {
    id: entry.id,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {})
  };
}

/** Resolve and validate one untrusted plugin-config snapshot into the frozen runtime shape. */
export function resolvePluginConfig(config: PluginConfig): ResolvedPluginConfig {
  const vision = config.vision ?? {};
  const tool = config.tool ?? {};
  const compact = config.compact ?? {};
  const engine = config.engine ?? {};

  const providerRef = typeof vision.provider === 'string' && vision.provider.length > 0 ? vision.provider : undefined;

  if (typeof vision.model !== 'string' || vision.model.length === 0) {
    throw new Error('dsh-auxiliary: vision.model must be a non-empty string');
  }
  if (providerRef === undefined && (typeof vision.baseURL !== 'string' || vision.baseURL.length === 0)) {
    throw new Error('dsh-auxiliary: vision.baseURL must be a non-empty string when no vision.provider reference is set');
  }
  const streamIdleTimeoutMs = vision.streamIdleTimeoutMs ?? DEFAULT_VISION_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-auxiliary: vision.streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  const seen = new Set<string>();
  const models = Array.isArray(vision.models)
    ? vision.models.map((entry, index) => {
        const resolved = resolveModelEntry(entry, index);
        if (seen.has(resolved.id)) throw new Error(`dsh-auxiliary: duplicate vision model "${resolved.id}"`);
        seen.add(resolved.id);
        return resolved;
      })
    : [];

  const compactProvider = typeof compact.provider === 'string' ? compact.provider : '';
  const compactModel = typeof compact.model === 'string' ? compact.model : '';
  if (Boolean(compactProvider) !== Boolean(compactModel)) {
    throw new Error('dsh-auxiliary: compact.provider and compact.model must be set together');
  }

  const thresholdRatio = engine.thresholdRatio ?? 0.8;
  const retainRatio = engine.retainRatio ?? 0.16;
  if (retainRatio >= thresholdRatio) {
    throw new Error('dsh-auxiliary: engine.retainRatio must be less than engine.thresholdRatio');
  }

  return deepFreeze({
    vision: {
      enabled: vision.enabled ?? true,
      displayName: typeof vision.displayName === 'string' && vision.displayName.length > 0 ? vision.displayName : 'Aux Vision (OpenAI-compatible)',
      baseURL: typeof vision.baseURL === 'string' ? vision.baseURL : '',
      apiKeyEnv: typeof vision.apiKeyEnv === 'string' && vision.apiKeyEnv.length > 0 ? vision.apiKeyEnv : DEFAULT_VISION_API_KEY_ENV,
      model: vision.model,
      models,
      maxTokens: vision.maxTokens ?? DEFAULT_VISION_MAX_TOKENS,
      defaultContextWindow: vision.defaultContextWindow ?? DEFAULT_VISION_CONTEXT_WINDOW,
      streamIdleTimeoutMs,
      retryPolicy: resolveRetryPolicy(vision.retryPolicy ?? { mode: 'normal', maxRetries: 2 }, 'dsh-auxiliary: vision.retryPolicy'),
      provider: providerRef
    },
    tool: {
      enabled: tool.enabled ?? true,
      maxImageBytes: tool.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      timeoutMs: tool.timeoutMs ?? DEFAULT_VISION_TOOL_TIMEOUT_MS
    },
    compact: {
      enabled: compact.enabled ?? false,
      provider: compactProvider,
      model: compactModel
    },
    engine: {
      enabled: engine.enabled ?? false,
      thresholdRatio,
      retainRatio,
      maxTokens: engine.maxTokens ?? DEFAULT_ENGINE_MAX_TOKENS,
      compactionRetries: engine.compactionRetries ?? 1,
      maxOverflowRetries: engine.maxOverflowRetries ?? 1,
      auto: engine.auto ?? true,
      compressPrompt: typeof engine.compressPrompt === 'string' && engine.compressPrompt.length > 0 ? engine.compressPrompt : DEFAULT_COMPRESS_PROMPT
    }
  });
}

export { Config };
