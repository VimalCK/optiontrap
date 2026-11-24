import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAutomationConfig } from '../../shared/automation.js';
import { TEST_STRATEGIES } from '@/services/strategies.fixture';
import { StrategySwitches } from './Settings';

const [STRATEGY] = TEST_STRATEGIES;

/** The switch labelled `label`, as rendered. */
const toggle = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes('role="switch"') && tag.includes(`aria-label="${label}"`)) ?? '';

const switches = (enabled: boolean, active: boolean) => {
  const config = { ...defaultAutomationConfig(TEST_STRATEGIES), enabled };
  config.strategies[STRATEGY.id].active = active;
  return renderToStaticMarkup(<StrategySwitches strategies={TEST_STRATEGIES} config={config} saving={false} onToggle={() => {}} />);
};

describe('StrategySwitches', () => {
  it("shows each strategy's own switch while Algo Trading is on", () => {
    expect(toggle(switches(true, true), STRATEGY.label)).toContain('aria-checked="true"');
    expect(toggle(switches(true, true), STRATEGY.label)).not.toContain('disabled');
    expect(toggle(switches(true, false), STRATEGY.label)).toContain('aria-checked="false"');
  });

  it('shows every strategy off and locked while Algo Trading is off, saying each keeps its setting', () => {
    const html = switches(false, true);
    expect(toggle(html, STRATEGY.label)).toContain('aria-checked="false"');
    expect(toggle(html, STRATEGY.label)).toContain('disabled');
    expect(html).toContain('Off while Algo Trading is off · each keeps its own setting');
  });
});
