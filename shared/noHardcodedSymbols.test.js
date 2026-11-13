import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'migrations']);

const ALLOWED = new Map([
  // The login page's decorative preview: made-up numbers, shown before login, so it can't read the table.
  [path.join('src', 'pages', 'Login.tsx'), 'demo card caption'],
]);

/** Index F&O names, index price rows ("NIFTY 50", "NIFTY BANK" …), TradingView index symbols, and index tokens. */
const SYMBOL = /\b(?:NIFTY\w*|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX|CNXFINANCE)\b/;
const INDEX_TOKEN = /\b(?:256265|260105|257801|288009|270857)\b/;

/** The code without its comments. `//` after a quote or colon (a URL in a string) is kept. */
export function stripComments(text, file) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1');
  return file.endsWith('.sql') ? code.replace(/--.*$/gm, '') : code;
}

/** The first symbol or index token in the file's code, or null. */
export function findHardcoded(text, file) {
  const code = stripComments(text, file);
  return code.match(SYMBOL)?.[0] ?? code.match(INDEX_TOKEN)?.[0] ?? null;
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(js|ts|tsx|sql)$/.test(entry.name) && !/\.test\.(js|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('no hardcoded symbols', () => {
  it('finds symbol names and index tokens in code, but not in comments', () => {
    expect(findHardcoded("const key = 'NSE:NIFTY BANK';", 'a.js')).toBe('NIFTY');
    expect(findHardcoded('if (name === "BANKNIFTY") {}', 'a.ts')).toBe('BANKNIFTY');
    expect(findHardcoded('const token = 256265;', 'a.js')).toBe('256265');
    expect(findHardcoded("WHERE instrument_token <> 260105", 'a.sql')).toBe('260105');
    expect(findHardcoded('/** e.g. NIFTY 50 */\nconst a = 1; // like NIFTY', 'a.js')).toBeNull();
    expect(findHardcoded('-- keeps NIFTY 50\nSELECT 1;', 'a.sql')).toBeNull();
    expect(findHardcoded("const url = 'https://example.com/NIFTY';", 'a.js')).toBe('NIFTY');
  });

  it('has none in the app code: they come from the instruments table', () => {
    const offenders = ['src', 'server', 'shared']
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .filter((file) => !ALLOWED.has(path.relative(root, file)))
      .map((file) => ({ file: path.relative(root, file), found: findHardcoded(fs.readFileSync(file, 'utf8'), file) }))
      .filter(({ found }) => found !== null);
    expect(offenders).toEqual([]);
  });
});
