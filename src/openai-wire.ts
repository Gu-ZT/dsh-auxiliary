/**
 * Translate harness messages into the OpenAI-compatible chat-completions wire
 * format. Image content blocks are resolved through the injected attachment
 * reader into `data:` URLs, so the adapter stays free of any concrete storage
 * backend. Reasoning blocks in history are dropped (the wire format has no
 * history slot for them), and tool results become `role: "tool"` messages.
 *
 * @module dsh-auxiliary/openai-wire
 */
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment';

/** One `image_url` content part of an OpenAI-compatible user message. */
export interface WireImagePart {
  type: 'image_url';
  image_url: { url: string };
}

/** One plain-text content part of an OpenAI-compatible user message. */
export interface WireTextPart {
  type: 'text';
  text: string;
}

/** A user-role content part. */
export type WireContentPart = WireTextPart | WireImagePart;

/** One tool invocation carried by an assistant message. */
export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** One OpenAI-compatible wire message. */
export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | WireContentPart[];
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

/** Resolve a durable image reference to verified bytes. */
export type ImageReader = (ref: ImageAttachmentRef) => Promise<StoredImageAttachment>;

/** Join every text block of a message body into one flat string. */
export function textOfBlocks(blocks: readonly ContentBlock[]): string {
  return blocks.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

/** Base64-encode one raster payload into a `data:` URL for the wire request. */
export function imageDataUrl(mediaType: string, data: Uint8Array): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`;
}

/** Map one image block to its wire part, reading the durable bytes on demand. */
async function toWirePart(block: ContentBlock, readImage: ImageReader): Promise<WireContentPart | undefined> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image': {
      const stored = await readImage(block.attachment);
      return {
        type: 'image_url',
        image_url: { url: imageDataUrl(stored.ref.mediaType, stored.data) }
      };
    }
    default:
      return undefined;
  }
}

/** Map one user-role message to its wire form (content parts, or a tool result). */
async function toWireUser(message: Message, readImage: ImageReader): Promise<WireMessage> {
  const toolResult = message.content.find((block) => block.type === 'tool-result');
  if (toolResult !== undefined && toolResult.type === 'tool-result') {
    return {
      role: 'tool',
      tool_call_id: toolResult.toolCallId,
      content: textOfBlocks(toolResult.content)
    };
  }
  const parts: WireContentPart[] = [];
  for (const block of message.content) {
    const part = await toWirePart(block, readImage);
    if (part !== undefined) parts.push(part);
  }
  if (parts.length === 1 && parts[0].type === 'text') return { role: 'user', content: parts[0].text };
  return { role: 'user', content: parts };
}

/** Map one assistant message to its wire form (text plus optional tool calls). */
function toWireAssistant(message: Message): WireMessage {
  const text = textOfBlocks(message.content);
  const toolCalls = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
    .map((block) => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments }
    }));
  return {
    role: 'assistant',
    ...(text.length > 0 ? { content: text } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  };
}

/** Translate a full harness message list into the OpenAI-compatible wire format. */
export async function toWireMessages(
  messages: readonly Message[],
  readImage: ImageReader
): Promise<WireMessage[]> {
  const out: WireMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      out.push({ role: 'system', content: textOfBlocks(message.content) });
    } else if (message.role === 'user') {
      out.push(await toWireUser(message, readImage));
    } else if (message.role === 'assistant') {
      out.push(toWireAssistant(message));
    }
  }
  return out;
}
