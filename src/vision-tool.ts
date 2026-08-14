/**
 * The model-facing `inspect_image` tool: read a local image file, commit it
 * through the attachment seam, and ask the auxiliary vision model about it.
 * The tool stays registered even when the vision provider is misconfigured and
 * then fails with a structured error at execution time, mirroring the web-tool
 * enablement pattern.
 *
 * @module dsh-auxiliary/vision-tool
 */
import type { Context } from '@deepseek-ai/cordis';
import { BlockAssembler, createUserMessage, deepFreeze, type ContentBlock, type GenerateOptions } from '@deepseek-ai/dsh-llm';
import { ToolArgsError, defineTool } from '@deepseek-ai/dsh-tools';
import '@deepseek-ai/dsh-fs';
import type { ImageMediaType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { deadline } from '@deepseek-ai/dsh-timeout';
import { PLUGIN_NAME, type ResolvedPluginConfig } from './config.js';
import { VISION_PROVIDER } from './vision-adapter.js';

/** Timeout code stamped on vision-tool aborts. */
const VISION_TOOL_TIMEOUT_CODE = 'AUX_VISION_TOOL_TIMEOUT';

/** Default question when the model does not supply one. */
const DEFAULT_QUESTION = 'Describe this image in detail, including any visible text, UI elements, diagrams, or code.';

/** Extension -> accepted raster media type. */
const EXTENSION_MEDIA: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

/** Validated model arguments of one `inspect_image` call. */
interface InspectImageArgs {
  path: string;
  question?: string;
}

/** Parse and validate raw model arguments. */
function parseArgs(args: unknown): InspectImageArgs {
  const value = args as { path?: unknown; question?: unknown } | null;
  if (value === null || typeof value !== 'object' || typeof value.path !== 'string' || value.path.length === 0) {
    throw new ToolArgsError(['inspect_image: "path" must be a non-empty string']);
  }
  if (value.question !== undefined && typeof value.question !== 'string') {
    throw new ToolArgsError(['inspect_image: "question" must be a string when present']);
  }
  return { path: value.path, question: value.question };
}

/** Derive the accepted media type from a file path's extension. */
function mediaTypeForPath(path: string): ImageMediaType {
  const extension = (path.split('.').pop() ?? '').toLowerCase();
  const media = EXTENSION_MEDIA[extension];
  if (media === undefined) {
    throw new Error(`inspect_image: unsupported image extension ".${extension}" (supported: png/jpg/jpeg/webp/gif)`);
  }
  return media;
}

/** Strip directory components from a file path for display. */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Run one one-shot auxiliary vision call and return its text answer. */
async function askVision(
  ctx: Context,
  get: () => ResolvedPluginConfig,
  attachment: ImageAttachmentRef,
  question: string,
  signal: AbortSignal,
  sessionId: GenerateOptions['sessionId']
): Promise<string> {
  const vision = get().vision;
  if (!vision.enabled) {
    throw new Error('inspect_image: the vision auxiliary model is disabled; enable dsh-auxiliary.vision in config');
  }
  const messages = [
    createUserMessage({
      content: [
        { type: 'image', attachment },
        { type: 'text', text: question }
      ],
      source: { kind: 'plugin', plugin: PLUGIN_NAME }
    })
  ];
  const timeout = deadline(signal, get().tool.timeoutMs, VISION_TOOL_TIMEOUT_CODE);
  try {
    const assembler = new BlockAssembler();
    // `provider` selects the route: an already-configured provider reference
    // (set from the settings UI) or the aux-vision custom endpoint.
    const provider = vision.provider ?? VISION_PROVIDER;
    for await (const chunk of ctx.llm.stream(deepFreeze({
      provider,
      model: vision.model,
      messages,
      maxTokens: vision.maxTokens,
      ...(sessionId !== undefined ? { sessionId } : {}),
      signal: timeout.signal
    }))) {
      assembler.push(chunk);
    }
    const finish = assembler.finish;
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(`inspect_image: vision model call failed (${finish.failure.code}): ${finish.failure.message}`);
    }
    if (finish.kind === 'max-tokens') {
      throw new Error('inspect_image: vision model output exceeded the configured maxTokens');
    }
    if (finish.kind === 'tool-calls') {
      throw new Error('inspect_image: vision model unexpectedly requested a tool');
    }
    const text = assembler.blocks().filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text).join(' ');
    if (text.trim().length === 0) {
      throw new Error('inspect_image: vision model produced no text');
    }
    return text;
  } finally {
    timeout[Symbol.dispose]();
  }
}

/** Register the `inspect_image` tool plus its system-prompt guidance. */
export function registerVisionTool(ctx: Context, get: () => ResolvedPluginConfig): void {
  ctx.systemPrompt.section({
    name: 'tool:inspect_image',
    order: 160,
    text: 'Use the inspect_image tool to analyze local image files (screenshots, photos, diagrams) with the auxiliary vision model. Pass the file path and an optional question; the answer comes back as text.'
  });
  ctx.tools.register(defineTool({
    name: 'inspect_image',
    description: 'Analyze a local image file with the auxiliary vision model. Pass an absolute or workspace-relative path to a PNG/JPEG/WebP/GIF file and an optional question; returns the vision model\'s answer as text.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute or workspace-relative path to the image file.'
      },
      question: {
        type: 'string',
        description: 'What to ask about the image. Defaults to a general description.'
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          path: { type: 'string' }
        }
      },
      render: (_args, value) => [{ type: 'text', text: value.content ?? '' }],
      presentationMeta: (_args, value) => value
    },
    timeoutMs: get().tool.timeoutMs,
    async execute(args, exec) {
      const input = parseArgs(args);
      const policy = get().tool;
      const cwd = exec.agent?.session.header.cwd;
      const target = await ctx.fs.resolve(input.path, {
        ...(cwd !== undefined ? { cwd } : {}),
        signal: exec.signal
      });
      const info = await ctx.fs.stat(target, exec.signal);
      if (info === undefined || info.type !== 'file') {
        throw new Error(`inspect_image: "${input.path}" is not a readable regular file`);
      }
      if (info.size !== undefined && info.size > policy.maxImageBytes) {
        throw new Error(`inspect_image: "${input.path}" is ${info.size} bytes, exceeding maxImageBytes ${policy.maxImageBytes}`);
      }
      const data = await ctx.fs.readBytes(target, exec.signal, policy.maxImageBytes);
      const ref = await ctx.attachments.saveImage({
        data,
        mediaType: mediaTypeForPath(input.path),
        name: basename(input.path)
      });
      const answer = await askVision(ctx, get, ref, input.question ?? DEFAULT_QUESTION, exec.signal, exec.agent?.session.id);
      return { content: answer, path: input.path };
    }
  }));
}
