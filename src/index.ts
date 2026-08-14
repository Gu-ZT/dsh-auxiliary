/**
 * dsh-auxiliary — auxiliary models for DeepSeek Harness.
 *
 * Exposes the `inspect_image` tool through an already-configured vision-capable
 * provider/model pair, reroutes compaction summaries to a dedicated auxiliary
 * pair, and optionally replaces the compaction backend with an explicit
 * compression engine.
 *
 * @module dsh-auxiliary
 */
import type { Context } from '@deepseek-ai/cordis';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { Config, PLUGIN_NAME, resolvePluginConfig, type PluginConfig, type ResolvedPluginConfig } from './config.js';
import { registerVisionTool } from './vision-tool.js';
import { installCompactRouter } from './compact-router.js';
import { installCompressionEngine } from './compress-engine.js';

export { Config, PLUGIN_NAME, resolvePluginConfig } from './config.js';
export { registerVisionTool } from './vision-tool.js';
export { installCompactRouter, compactRoute } from './compact-router.js';
export { CompressEngine, installCompressionEngine } from './compress-engine.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = PLUGIN_NAME;

/** Services required by `inspect_image`, compaction routing, and compression. */
export const inject = ['llm', 'tools', 'systemPrompt', 'attachments', 'fs'];

/** User-settings namespace owning the whole plugin section. */
const NS = settingsNamespace(PLUGIN_NAME);

/**
 * Dormant directory entry that exposes this plugin's settings namespace to the
 * browser. It intentionally has no adapter registration and is never a model
 * route or custom endpoint; generic provider views expose it as inactive, and
 * the auxiliary selector filters it out.
 */
const SETTINGS_DIRECTORY_PROVIDER = 'dsh-auxiliary-settings';

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

  ctx.llm.registerConfigurableProviders([{
    provider: SETTINGS_DIRECTORY_PROVIDER,
    displayName: 'dsh-auxiliary settings',
    settingsNs: NS,
    settingsPath: ['vision']
  }]);
  let visionToolDisposer: (() => void) | undefined;
  const disposeVisionTool = (): void => {
    const disposer = visionToolDisposer;
    visionToolDisposer = undefined;
    disposer?.();
  };
  const reconcileVisionTool = (): void => {
    if (resolved().tool.enabled) {
      if (visionToolDisposer === undefined) {
        visionToolDisposer = registerVisionTool(ctx, resolved);
      }
      return;
    }
    disposeVisionTool();
  };

  ctx.effect(() => () => {
    disposeVisionTool();
  }, 'dsh-auxiliary: vision tool lifecycle');

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: reconcileVisionTool,
    validate: resolvePluginConfig
  });

  reconcileVisionTool();
  installCompactRouter(ctx, resolved);
  if (resolved().engine.enabled) {
    installCompressionEngine(ctx, resolved);
  }
}
