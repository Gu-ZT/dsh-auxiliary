/**
 * The model-facing `generate_image` tool: ask the configured auxiliary
 * image-generation model to produce images, save them under the session's
 * working directory, and return the file paths.
 *
 * The harness LLM seam only speaks text, so this tool talks to the provider's
 * OpenAI-compatible images endpoint directly: the provider route's `baseURL`
 * plus the `apiKeyEnv` credential reference (read from the resolved
 * `llm-pi-ai` settings namespace) drive the request, and the generated images
 * are written as PNG files through node fs. When the feature is disabled or
 * incomplete the tool stays unregistered (the model never sees it).
 *
 * @module dsh-auxiliary/imagegen-tool
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PLUGIN_NAME, type ResolvedPluginConfig } from './config.js';

/** The llm-pi-ai settings namespace that owns the provider routes. */
const LLM_PI_AI_NS = settingsNamespace('llm-pi-ai');

/** Default generated-image side; the OpenAI images API accepts this. */
const DEFAULT_SIZE = '1024x1024';

/** Naming the plugin in tool guidance. */
const TOOL_SECTION = 'tool:generate_image';

/** Parse and validate the `generate_image` arguments. */
function parseArgs(args: Record<string, unknown>): { prompt: string; size: string; count: number } {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (prompt.length === 0) {
    throw new Error('generate_image: "prompt" must be a non-empty string describing the image to generate');
  }
  const size = typeof args.size === 'string' && args.size.trim().length > 0 ? args.size.trim() : DEFAULT_SIZE;
  const rawCount = args.n === undefined ? 1 : args.n;
  const count = typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= 1 ? rawCount : 1;
  return { prompt, size, count };
}

/**
 * Register the `generate_image` tool plus system-prompt guidance.
 *
 * @returns a disposer that removes both registrations made by this function.
 */
export function registerImagegenTool(ctx: Context, get: () => ResolvedPluginConfig): () => void {
  const disposePrompt = ctx.systemPrompt.section({
    name: TOOL_SECTION,
    order: 165,
    text: 'Use the generate_image tool to create images with the configured auxiliary image-generation model when the user asks to generate, draw, or create a picture. Pass a detailed "prompt" describing the desired image. The tool saves the generated images under the current working directory (generated/) and returns their file paths; you can then inspect them with inspect_image to describe or verify them.'
  });
  const disposeTool = ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate images with the configured auxiliary image-generation model (OpenAI-compatible images API). Pass a detailed prompt; images are saved under the working directory and their file paths are returned.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Detailed description of the image to generate.'
      },
      size: {
        type: 'string',
        description: 'Requested size, e.g. 1024x1024, 1792x1024, or 1024x1792. Defaults to 1024x1024.'
      },
      n: {
        type: 'number',
        description: 'How many images to generate (most providers accept only 1). Defaults to 1.'
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } }
        }
      },
      render: (_args, value) => [{ type: 'text', text: value.content ?? '' }],
      presentationMeta: (_args, value) => value
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const input = parseArgs(args);
      const imagegen = get().imagegen;
      if (!imagegen.enabled || imagegen.provider === undefined || imagegen.model === undefined) {
        throw new Error(
          'generate_image: the auxiliary image-generation model is not configured — enable it under Settings → Auxiliary Models → Image-generation model and pick a model marked for image generation',
        );
      }
      const namespace = ctx.settings.get(LLM_PI_AI_NS) as
        { providers?: Record<string, { baseURL?: string; apiKeyEnv?: string }> } | undefined;
      const provider = namespace?.providers?.[imagegen.provider];
      const baseURL = provider?.baseURL;
      // apiKeyEnv is a credential reference; resolve it through the harness
      // credential seam (env / file / user-env layers), never process.env.
      let apiKey: string | undefined;
      const ref = provider?.apiKeyEnv;
      if (ref !== undefined && ref.length > 0) {
        const resolved = await ctx.credentials.resolve(credentialRef(ref));
        apiKey = resolved?.value;
      }
      if (baseURL === undefined || baseURL.length === 0 || apiKey === undefined) {
        throw new Error(
          `generate_image: provider "${imagegen.provider}" is missing a baseURL or its API key is not configured (${ref ?? 'no apiKeyEnv'})`,
        );
      }
      const endpoint = `${baseURL.replace(/\/+$/, '')}/images/generations`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: imagegen.model,
          prompt: input.prompt,
          size: input.size,
          n: input.count,
        }),
        signal: exec.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`generate_image: provider returned ${response.status}${detail.length > 0 ? `: ${detail.slice(0, 400)}` : ''}`);
      }
      const body = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
      const items = body.data ?? [];
      if (items.length === 0) {
        throw new Error('generate_image: the provider returned no images');
      }
      const cwd = exec.agent?.session.header.cwd;
      const dir = join(cwd ?? '.', 'generated');
      await mkdir(dir, { recursive: true });
      const paths: string[] = [];
      const stamp = Date.now();
      for (const [index, item] of items.entries()) {
        let buffer: Buffer;
        if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
          buffer = Buffer.from(item.b64_json, 'base64');
        } else if (typeof item.url === 'string' && item.url.length > 0) {
          const imageResponse = await fetch(item.url, { signal: exec.signal });
          if (!imageResponse.ok) continue;
          buffer = Buffer.from(await imageResponse.arrayBuffer());
        } else {
          continue;
        }
        const file = join(dir, `${PLUGIN_NAME}-${stamp}-${index + 1}.png`);
        await writeFile(file, buffer);
        paths.push(file);
      }
      if (paths.length === 0) {
        throw new Error('generate_image: none of the provider responses contained a decodable image');
      }
      return {
        content: `Generated ${paths.length} image(s):\n${paths.map((path) => `- ${path}`).join('\n')}`,
        paths,
      };
    },
  }));

  return () => {
    disposePrompt();
    disposeTool();
  };
}
