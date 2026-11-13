import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Files that draw data as SVG. A chart is not an icon, so it may draw its own <svg>. */
const ALLOWED: Record<string, string> = {
  'components/OiHistory/FuturesContext.tsx': 'futures price chart',
  'components/OiHistory/StrikeOiChart.tsx': 'strike OI and premium chart',
  'components/OptionChain/OptionChain.tsx': 'OI move sparkline in the chart tooltip',
  'pages/Positions.tsx': 'payoff curve',
  'components/icons/Icons.tsx': 'the icons themselves',
};

const tsxFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return tsxFiles(full);
  return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [full] : [];
});

describe('icons', () => {
  it('are drawn only in Icons.tsx: no other file but a chart has an inline <svg>', () => {
    const offenders = tsxFiles(SRC)
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
      .filter((file) => !ALLOWED[file] && fs.readFileSync(path.join(SRC, file), 'utf8').includes('<svg'));
    expect(offenders).toEqual([]);
  });
});
