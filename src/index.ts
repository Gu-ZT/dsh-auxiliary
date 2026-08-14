/**
 * dsh-auxiliary — auxiliary models for DeepSeek Harness.
 *
 * Registers an OpenAI-compatible vision provider route (`aux-vision`) on the
 * LLM seam, exposes the `inspect_image` tool, reroutes compaction summaries to
 * a dedicated auxiliary summarizer pair, and optionally replaces the compaction
 * backend with an explicit compression engine.
 *
 * @module dsh-auxiliary
 */
import type { Context } from '@deepseek-ai/cordis';
import { LlmError, assertUsableApiKey } from '@deepseek-ai/dsh-llm';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { Config, PLUGIN_NAME, resolvePluginConfig, type PluginConfig, type ResolvedPluginConfig } from './config.js';
import { VISION_PROVIDER, VisionAdapter } from './vision-adapter.js';
import { registerVisionTool } from './vision-tool.js';
import { installCompactRouter } from './compact-router.js';
import { installCompressionEngine } from './compress-engine.js';

export { Config, PLUGIN_NAME, resolvePluginConfig } from './config.js';
export { VISION_PROVIDER, VisionAdapter } from './vision-adapter.js';
export { registerVisionTool } from './vision-tool.js';
export { installCompactRouter, compactRoute } from './compact-router.js';
export { CompressEngine, installCompressionEngine } from './compress-engine.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = PLUGIN_NAME;

/** Services required by the vision provider and the `inspect_image` tool. */
export const inject = ['llm', 'tools', 'systemPrompt', 'attachments', 'fs'];

/** User-settings namespace owning the whole plugin section. */
const NS = settingsNamespace(PLUGIN_NAME);

/** Resolve a usable API key through the credential seam, then the launch environment. */
function resolveApiKeyFor(ctx: Context, ref: string): () => Promise<string> {
  return async () => {
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
      const hit = await credentials.resolve(credentialRef(ref));
      if (hit !== undefined) return assertUsableApiKey(hit.value, PLUGIN_NAME, ref);
    }
    const ambient = launchEnvironmentOf(ctx).get(ref);
    if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, PLUGIN_NAME, ref);
    throw new LlmError(
      `dsh-auxiliary: no API key for provider route "${VISION_PROVIDER}"; store ${ref} through the credentials service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL'
    );
  };
}

/** Cordis plugin entry. */
export function apply(ctx: Context, config: PluginConfig): void {
  let current = () => config;
  let lastRaw: PluginConfig | undefined;
  let lastGood: ResolvedPluginConfig | undefined;
  const resolved = (): ResolvedPluginConfig => {
    const raw = current();
    if (raw === lastRaw && lastGood !== undefined) return lastGood;
    try {
      const next = resolvePluginConfig(raw);
      lastRaw = raw;
      lastGood = next;
      return next;
    } catch (error) {
      if (lastGood === undefined) throw error;
      lastRaw = raw;
      ctx.logger.error('dsh-auxiliary: keeping the last good configuration after an invalid settings section');
      ctx.logger.error(error);
      return lastGood;
    }
  };

  const vision = resolved();
  if (vision.vision.enabled) {
    const attachments = ctx.get('attachments');
    if (attachments === undefined) {
      throw new Error('dsh-auxiliary: the vision provider requires the attachments service');
    }
    const adapter = new VisionAdapter({
      options: () => resolved().vision,
      resolveApiKey: resolveApiKeyFor(ctx, resolved().vision.apiKeyEnv),
      readImage: (ref) => attachments.readImage(ref)
    });
    ctx.llm.registerConfigurableProviders([{
      provider: VISION_PROVIDER,
      displayName: resolved().vision.displayName,
      settingsNs: NS,
      settingsPath: ['vision']
    }]);
    const registration = ctx.llm.registerAdapter([VISION_PROVIDER], adapter);
    let registeredPolicy = resolved().vision.retryPolicy;
    const ensureRegistrationFacts = () => {
      const policy = resolved().vision.retryPolicy;
      if (deepEqualJson(policy, registeredPolicy)) return;
      registration.replace([VISION_PROVIDER]);
      registeredPolicy = policy;
    };
    installSettingsSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source;
      },
      onChange: ensureRegistrationFacts
    });
  } else {
    installSettingsSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source;
      },
      onChange: () => {}
    });
  }

  if (vision.vision.enabled && vision.tool.enabled) {
    registerVisionTool(ctx, resolved);
  }
  installCompactRouter(ctx, resolved);
  if (resolved().engine.enabled) {
    installCompressionEngine(ctx, resolved);
  }
}
