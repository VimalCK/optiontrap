import { describe, it, expect } from 'vitest';
import { parseSseBlock, readSseEvents, type SseEvent } from './sseEvents';

const streamOf = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  },
});

describe('parseSseBlock', () => {
  it('reads the event name and joins the data lines', () => {
    expect(parseSseBlock('event: progress\ndata: {"pct":\ndata: 40}')).toEqual({ event: 'progress', data: '{"pct":40}' });
  });
});

describe('readSseEvents', () => {
  it('emits each block once complete, however the chunks split it, and a last block without a blank line', async () => {
    const events: SseEvent[] = [];
    await readSseEvents(streamOf(['event: st', 'ep\ndata: {"a":1}\n', '\nevent: done\ndata: {}']), (e) => events.push(e));
    expect(events).toEqual([{ event: 'step', data: '{"a":1}' }, { event: 'done', data: '{}' }]);
  });

  it('stops at an error the handler throws', async () => {
    const read = readSseEvents(streamOf(['event: error\ndata: {}\n\nevent: step\ndata: {}\n\n']), (e) => {
      if (e.event === 'error') throw new Error('stream failed');
    });
    await expect(read).rejects.toThrow('stream failed');
  });
});
