/**
 * Minimal dependency-free SSE (Server-Sent Events) parser for streaming
 * OpenAI-compatible chat completions. Only the fields we consume are kept:
 * `data:` lines are accumulated per event and joined with newlines; comment
 * lines and other fields are ignored. A final unterminated event is still
 * emitted so a provider that omits the trailing blank line does not lose the
 * `[DONE]` marker or the last payload.
 *
 * @module dsh-auxiliary/sse
 */

/** One parsed SSE event; `data` is absent when the event carried no data lines. */
export interface SseEvent {
  readonly data: string;
}

/** Split the leading complete event off a buffered chunk; `undefined` when incomplete. */
function splitNextEvent(buffer: string): { event: string; rest: string } | undefined {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return undefined;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { event: buffer.slice(0, crlf), rest: buffer.slice(crlf + 4) };
  }
  return { event: buffer.slice(0, lf), rest: buffer.slice(lf + 2) };
}

/** Parse one raw event block into its data payload, or `undefined` when it has none. */
function parseEvent(raw: string): SseEvent | undefined {
  const lines = raw.split(/\r?\n/);
  const data: string[] = [];
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(':')) continue;
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return undefined;
  return { data: data.join('\n') };
}

/**
 * Iterate SSE events from a `fetch` response body. The body is released when
 * iteration ends or is aborted.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split: { event: string; rest: string } | undefined;
      while ((split = splitNextEvent(buffer)) !== undefined) {
        buffer = split.rest;
        const event = parseEvent(split.event);
        if (event !== undefined) yield event;
      }
    }
    if (buffer.length > 0) {
      const event = parseEvent(buffer);
      if (event !== undefined) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
