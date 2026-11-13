export interface SseEvent { event: string; data: string }

/** One server-sent event block: its `event:` name and its `data:` lines joined. */
export function parseSseBlock(block: string): SseEvent {
  let event = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
  }
  return { event, data };
}

/**
 * Reads a server-sent event stream to its end, calling `onEvent` for each complete block (blocks end at a blank
 * line). Robust to network chunks splitting anywhere, including between "event:" and "data:". An error thrown by
 * `onEvent` stops the read.
 */
export async function readSseEvents(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = (block: string) => { if (block.trim()) onEvent(parseSseBlock(block)); };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator: number;
    while ((separator = buffer.indexOf('\n\n')) !== -1) {
      emit(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
    }
  }
  emit(buffer);
}
