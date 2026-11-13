import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OrderModalSwitch from './OrderModalSwitch';

describe('OrderModalSwitch', () => {
  const html = renderToStaticMarkup(
    <OrderModalSwitch label="Order type" value="Limit" onChange={() => {}}
      options={[{ value: 'Market', label: 'Market' }, { value: 'Limit', label: 'Limit' }]} />,
  );

  it('is a named group of buttons, the chosen one pressed and highlighted', () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Order type"');
    const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    const [market, limit] = buttons;
    expect(market).toContain('aria-pressed="false"');
    expect(market).not.toContain('active');
    expect(limit).toContain('aria-pressed="true"');
    expect(limit).toContain('order-modal__mode-btn active');
    expect(limit).toContain('type="button"');
  });
});
