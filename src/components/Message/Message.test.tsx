import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Message from './Message';
import { MessageTone } from '@/utils/uiEnums';

describe('Message', () => {
  it('shows an error in the error tone and announces it at once', () => {
    const html = renderToStaticMarkup(<Message tone={MessageTone.Error} className="page-gap">Couldn't save</Message>);
    expect(html).toContain('class="message message--error page-gap"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t save");
  });

  it('shows a notice in the info tone, read when the screen reader is idle', () => {
    const html = renderToStaticMarkup(<Message tone={MessageTone.Info}>No trades in this range</Message>);
    expect(html).toContain('class="message message--info"');
    expect(html).toContain('role="status"');
  });
});
