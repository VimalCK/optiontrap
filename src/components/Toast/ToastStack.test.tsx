import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ToastStack from './ToastStack';
import { ToastColor } from '@/utils/uiEnums';

describe('ToastStack', () => {
  it('renders nothing without toasts', () => {
    expect(renderToStaticMarkup(<ToastStack toasts={[]} />)).toBe('');
  });

  it('shows each toast in its colour, with a lower-case class', () => {
    const html = renderToStaticMarkup(<ToastStack toasts={[
      { id: 1, text: 'Bought 24000CE', color: ToastColor.Green },
      { id: 2, text: 'Refused', color: ToastColor.Red },
    ]} />);
    expect(html).toBe('<div class="toast-stack" role="status"><div class="toast toast--green">Bought 24000CE</div><div class="toast toast--red">Refused</div></div>');
  });
});
