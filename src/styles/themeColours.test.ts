import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLOBAL_CSS = 'styles/global.css';
/** Where global.css's theme ends: everything above this line is the theme's own definitions. */
const THEME_END = '*,\n*::before,';

/** Colours written anywhere but the theme: hex, rgb()/rgba() with numbers, and the named white and black. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|(?<![\w-])(white|black)(?![\w-])/g;

/** Uses that look like a colour but aren't one, with the reason. */
const ALLOWED: Record<string, { match: string; reason: string }[]> = {
  'styles/subscribe.css': [{ match: 'black', reason: 'a mask shape: only its alpha counts, not its colour' }],
};

const sourceFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sourceFiles(full);
  return /\.(css|ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.fixture.ts') ? [full] : [];
});

/** The code a colour could hide in: CSS without comments, code without comments or its own test data. */
const checkedText = (file: string, text: string) => {
  const unix = text.replace(/\r\n/g, '\n');
  const body = file === GLOBAL_CSS ? unix.slice(unix.indexOf(THEME_END)) : unix;
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
  return file.endsWith('.css') ? withoutComments : withoutComments.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
};

describe('theme colours', () => {
  it('are defined once, in the theme block of global.css: no other CSS or code writes a colour', () => {
    const offenders = sourceFiles(SRC).flatMap((full) => {
      const file = path.relative(SRC, full).split(path.sep).join('/');
      const allowed = new Set((ALLOWED[file] ?? []).map((a) => a.match));
      const found = [...checkedText(file, fs.readFileSync(full, 'utf8')).matchAll(COLOUR_LITERAL)]
        .map((m) => m[0])
        // An element id or an anchor in code is not a colour; only CSS uses a bare #hex.
        .filter((m) => file.endsWith('.css') || !/^#/.test(m) || /^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/.test(m))
        .filter((m) => !allowed.has(m));
      return found.length > 0 ? [`${file}: ${[...new Set(found)].join(' ')}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('gives every colour token both its channels and its solid', () => {
    const theme = fs.readFileSync(path.join(SRC, GLOBAL_CSS), 'utf8').replace(/\r\n/g, '\n');
    const channels = [...theme.matchAll(/--([\w-]+)-rgb: \d+, \d+, \d+;/g)].map((m) => m[1]);
    const missingSolid = channels.filter((name) => !theme.includes(`--${name}: rgb(var(--${name}-rgb));`));
    expect(channels.length).toBeGreaterThan(0);
    expect(missingSolid).toEqual([]);
  });

  it('uses only tokens the theme defines', () => {
    const theme = fs.readFileSync(path.join(SRC, GLOBAL_CSS), 'utf8');
    const defined = new Set([...theme.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
    const undefinedTokens = sourceFiles(SRC).flatMap((full) => {
      const text = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const declaredHere = new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
      return [...text.matchAll(/rgba\(var\((--[\w-]+-rgb)\)/g)].map((m) => m[1]).filter((t) => !defined.has(t) && !declaredHere.has(t))
        .map((t) => `${path.relative(SRC, full)}: ${t}`);
    });
    expect(undefinedTokens).toEqual([]);
  });
});
