import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_CSS = 'styles/global.css';

/** Header cells that sit in a table's body, not its header, so their own background is fine. */
const BODY_HEADER_CELLS = ['day-group-row'];

const sourceFiles = (dir: string, extension: RegExp): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sourceFiles(full, extension);
  return extension.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
});

const relative = (full: string) => path.relative(SRC, full).split(path.sep).join('/');

/** Each CSS rule as its selector and declarations, comments removed. */
const cssRules = (text: string) => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));

/** The classes the app puts on header cells (`<th className="…">`), so a rule styling one by its class is caught too. */
const headerCellClasses = () => new Set(sourceFiles(SRC, /\.tsx$/).flatMap((full) =>
  [...fs.readFileSync(full, 'utf8').matchAll(/<th\b[^>]*?className=([^>]*?)>/g)].flatMap((m) => m[1].match(/[a-z][a-z0-9_-]*/g) ?? [])));

const namesClass = (selector: string, name: string) => new RegExp(`\\.${name}(?![\\w-])`).test(selector);

const headerCellSelector = (selector: string, classes: Set<string>) =>
  /(^|[\s,>])th\b/.test(selector) || [...classes].some((name) => namesClass(selector, name));

describe('sticky table headers', () => {
  it('every table header uses the shared sticky-head class', () => {
    const offenders = sourceFiles(SRC, /\.tsx$/).flatMap((full) => [...fs.readFileSync(full, 'utf8').matchAll(/<thead\b[^>]*>/g)]
      .filter((m) => !/className="[^"]*\bsticky-head\b/.test(m[0]))
      .map(() => relative(full)));
    expect(offenders).toEqual([]);
  });

  it('only the shared class makes a header stick to the top', () => {
    const offenders = sourceFiles(SRC, /\.css$/).filter((full) => relative(full) !== SHARED_CSS).flatMap((full) =>
      cssRules(fs.readFileSync(full, 'utf8'))
        .filter(({ body }) => /position:\s*sticky/.test(body) && /(^|[\s;])top:/.test(body))
        .map(({ selector }) => `${relative(full)}: ${selector}`));
    expect(offenders).toEqual([]);
  });

  it('every header has the one colour: no table sets its header cells\' background', () => {
    const classes = headerCellClasses();
    const offenders = sourceFiles(SRC, /\.css$/).filter((full) => relative(full) !== SHARED_CSS).flatMap((full) =>
      cssRules(fs.readFileSync(full, 'utf8'))
        .filter(({ selector, body }) => headerCellSelector(selector, classes) && /(^|[\s;])background(-color)?:/.test(body))
        .filter(({ selector }) => !BODY_HEADER_CELLS.some((name) => selector.includes(name)))
        .map(({ selector }) => `${relative(full)}: ${selector}`));
    expect(offenders).toEqual([]);
  });
});
