/**
 * Guards for the enums in every shared/*Enums.js file (tradeEnums, appEnums,
 * analysisEnums) and the browser's own in src/utils/uiEnums.ts; read from those
 * files, so a new enum or shared enum file is checked without touching this one:
 *
 * 1. No enum value typed by hand: code names `OrderStatus.Open`, never `'Open'`,
 *    and SQL writes `${sqlEnum(OrderStatus.Open)}` (server/sql.js), never a
 *    `'Open'` literal. Words that only happen to equal a value (a CSS class, a
 *    socket event) are listed in ALLOWED with the reason.
 * 2. No enum member inside string text: written in a SQL template without
 *    `${…}`, `Exchange.NFO` reaches Postgres as a table reference ("missing
 *    FROM-clause entry for table exchange").
 *
 * 3. No enum value in a .sql file the app runs (the nightly jobs): plain SQL
 *    can't call sqlEnum, so SQL that names a value is a .js job.
 * 4. Every CSS class modifier built from a value (`badge--${…}`) is lower-cased
 *    with .toLowerCase(), since enum values are capitalised and the stylesheets
 *    are not: `badge--${tone.toLowerCase()}`. A modifier that can only be a
 *    lower-case quoted word (`${on ? 'up' : 'down'}`) is fine; a helper that
 *    returns CSS words is listed in CSS_WORD_HELPERS with the reason.
 *
 * Checked: code in src, server and shared, outside comments, and every .sql
 * file outside server/migrations. Not checked: tests (they assert the stored
 * text) and migrations (a frozen, checksummed record of the schema, which
 * must name the values it writes).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'migrations']);
const ENUM_FILE_NAME = /Enums\.js$/;
const ENUM_FILES = new Set([
  ...fs.readdirSync(path.join(root, 'shared')).filter((name) => ENUM_FILE_NAME.test(name)).map((name) => path.join('shared', name)),
  path.join('src', 'utils', 'uiEnums.ts'),
]);
const enumModules = await Promise.all([...ENUM_FILES].map((file) => import(pathToFileURL(path.join(root, file)).href)));

/** The enums: exported frozen objects (`Side`, `OrderStatus` …), by name. */
const ENUMS = Object.entries(Object.assign({}, ...enumModules))
  .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && Object.isFrozen(value));

const ENUM_VALUES = new Set(ENUMS.flatMap(([, members]) => Object.values(members)));
const MEMBER = new RegExp(`\\b(?:${ENUMS.map(([name]) => name).join('|')})\\.[A-Z][A-Za-z]*\\b`, 'g');
/** A quoted enum value inside longer text, e.g. the 'Open' in "WHERE status = 'Open'". */
const QUOTED_WORD = /'([A-Za-z-]+)'/g;
/**
 * Text shown to the user, which may read like a value ("Open", "Paper"): a
 * label, title, hint or toggle text, or the label in a value → label map
 * (`[OrderStatus.Open]: 'Open'`). Matched against the code before the string.
 */
const DISPLAY_TEXT = /(?:\b(?:label|title|text|hint|term|meaning|column|group|onText|offText)\s*[:=]\s*\{?\s*|\]\s*:\s*)$/;

/**
 * Words that equal an enum value only by chance, by file, with the reason.
 * @type {Map<string, { values: string[], reason: string }[]>}
 */
const ALLOWED = new Map([
  [path.join('src', 'components', 'Automation', 'autoTradeView.ts'), [{ values: ['Selected', 'Rejected', 'Closed'], reason: "fallback wording of a lifecycle event shown to the user" }]],
  [path.join('src', 'components', 'PaperOrders', 'PaperOrders.tsx'), [{ values: ['Cancelled', 'Market'], reason: "the order badge and price-column wording" }]],
  [path.join('src', 'components', 'Sidebar', 'Sidebar.tsx'), [{ values: ['Admin'], reason: "the collapsed nav item tooltip" }]],
  [path.join('src', 'components', 'StockSetups', 'StockSetupsPanel.tsx'), [{ values: ['Rejected'], reason: "a zone that turned the price away (Held / Rejected wording)" }]],
  [path.join('src', 'components', 'WinLossPatterns', 'winLossStats.ts'), [{ values: ['Unknown'], reason: "the name shown for trades recorded without a strategy or setup" }]],
  [path.join('src', 'pages', 'AdminUsers.tsx'), [{ values: ['Unknown'], reason: "the name shown for a user without one" }]],
  [path.join('src', 'pages', 'Health.tsx'), [{ values: ['Active', 'Down', 'Idle'], reason: "the Kite connection wording (Active / Offline), the database's (Connected / Down) and the OI feed's (Fresh / Idle)" }]],
  [path.join('src', 'pages', 'Positions.tsx'), [{ values: ['Profit', 'Loss'], reason: "the payoff marker wording" }]],
  [path.join('src', 'pages', 'Profile.tsx'), [{ values: ['Inactive'], reason: "the subscription line shown when there is none" }]],
  [path.join('src', 'pages', 'Settings.tsx'), [{ values: ['Orders'], reason: "the Trading Mode card's eyebrow heading" }]],
  [path.join('src', 'pages', 'Watchlist.tsx'), [{ values: ['Active', 'Triggered'], reason: "the alert status wording shown in the list" }]],
  [path.join('server', 'tradeEngine', 'positions.js'), [{ values: ['Exit'], reason: "the algo log source tag" }]],
  [path.join('shared', 'paperOrders.js'), [{ values: ['Cancelled'], reason: "the cancel reason wording stored in status_reason" }]],
]);

/**
 * Modifier expressions that return CSS words, not enum values, by file, with the reason.
 * @type {Map<string, { expressions: string[], reason: string }[]>}
 */
const CSS_WORD_HELPERS = new Map([
  [path.join('src', 'components', 'OptionChain', 'OptionChain.tsx'), [{ expressions: ['sideClass'], reason: "'ce' or 'pe', set just above" }]],
  [path.join('src', 'components', 'SellStrategy', 'SellStrategy.tsx'), [
    { expressions: ['colorClass'], reason: 'scoreColorClass returns a CSS word' },
    { expressions: ['actionBtnClass(rec.type)'], reason: 'returns the lower-cased option type or a CSS word' },
  ]],
  [path.join('src', 'pages', 'Login.tsx'), [{ expressions: ['(i * 7) % 3'], reason: 'a number picking one of three decorative variants' }]],
]);

/** A quoted lower-case CSS word, e.g. 'rich'. */
const CSS_WORD = /^'[a-z0-9-]*'$/;

/**
 * Whether a ternary's every result is a quoted lower-case word: the parts
 * between ? / : that a : or the end follows (the others are conditions).
 * @param {string} expression
 */
function onlyCssWords(expression) {
  const parts = expression.split(/([?:])/);
  if (parts.length < 5) return false;
  const results = [];
  for (let i = 2; i < parts.length; i += 2) {
    const next = parts[i + 1];
    if (next === ':' || next === undefined) results.push(parts[i].trim());
  }
  return results.length > 0 && results.every((result) => CSS_WORD.test(result));
}

/**
 * CSS class modifiers (`--${…}`) in `source` built from a value that isn't
 * lower-cased, with their line.
 * @param {string} source
 * @param {string[]} [helpers] expressions known to return CSS words
 * @returns {{ line: number, expression: string }[]}
 */
export function unloweredClassModifiers(source, helpers = []) {
  /** @type {{ line: number, expression: string }[]} */
  const found = [];
  for (const match of source.matchAll(/--\$\{([^}]*)\}/g)) {
    const expression = match[1].trim();
    if (expression.endsWith('.toLowerCase()') || onlyCssWords(expression) || helpers.includes(expression)) continue;
    found.push({ line: source.slice(0, match.index).split('\n').length, expression });
  }
  return found;
}

/**
 * Every piece of string text in `source` outside comments: quoted strings, and
 * template text outside `${…}`, each with the line it starts on.
 * @param {string} source
 * @returns {{ line: number, text: string, quoted: boolean, before: string }[]}
 */
export function stringTexts(source) {
  /** @type {{ line: number, text: string, quoted: boolean, before: string }[]} */
  const found = [];
  const lineAt = (/** @type {number} */ offset) => source.slice(0, offset).split('\n').length;

  /** Read a template literal from its opening backtick; returns the offset after it. */
  const template = (/** @type {number} */ start) => {
    let i = start + 1;
    let textStart = i;
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === '$' && source[i + 1] === '{') {
        found.push({ line: lineAt(textStart), text: source.slice(textStart, i), quoted: false, before: '' });
        let depth = 1;
        i += 2;
        while (i < source.length && depth > 0) {
          if (source[i] === '`') { i = template(i); continue; }
          if (source[i] === '{') depth += 1;
          else if (source[i] === '}') depth -= 1;
          i += 1;
        }
        textStart = i;
        continue;
      }
      i += 1;
    }
    found.push({ line: lineAt(textStart), text: source.slice(textStart, i), quoted: false, before: '' });
    return i + 1;
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (char === '`') {
      i = template(i);
    } else if (char === '\'' || char === '"') {
      let end = i + 1;
      while (end < source.length && source[end] !== char && source[end] !== '\n') end += source[end] === '\\' ? 2 : 1;
      found.push({ line: lineAt(i + 1), text: source.slice(i + 1, end), quoted: true, before: source.slice(Math.max(0, i - 40), i) });
      i = end + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

/**
 * Enum values typed by hand in `source`: a whole string equal to one, or one
 * quoted inside longer text (a SQL literal). CSS class strings and display
 * text (DISPLAY_TEXT) are skipped.
 * @param {string} source
 * @returns {{ line: number, value: string }[]}
 */
export function rawEnumValues(source) {
  const lines = source.split('\n');
  return stringTexts(source).flatMap(({ line, text, quoted, before }) => {
    if (/className/.test(lines[line - 1] ?? '')) return [];
    if (quoted && ENUM_VALUES.has(text)) return DISPLAY_TEXT.test(before) ? [] : [{ line, value: text }];
    return [...text.matchAll(QUOTED_WORD)].filter((m) => ENUM_VALUES.has(m[1])).map((m) => ({ line, value: m[1] }));
  });
}

/**
 * Enum members written inside string text, e.g. `exchange = Exchange.NFO` in SQL.
 * @param {string} source
 * @returns {{ line: number, member: string }[]}
 */
export function membersInStrings(source) {
  return stringTexts(source).flatMap(({ line, text }) => [...text.matchAll(MEMBER)].map((m) => ({ line, member: m[0] })));
}

/**
 * Enum values quoted in plain SQL, outside `--` comments.
 * @param {string} sql
 * @returns {{ line: number, value: string }[]}
 */
export function sqlEnumLiterals(sql) {
  return sql.split('\n').flatMap((text, index) => [...text.replace(/--.*$/, '').matchAll(QUOTED_WORD)]
    .filter((m) => ENUM_VALUES.has(m[1]))
    .map((m) => ({ line: index + 1, value: m[1] })));
}

/** Files under `dir` (relative to the root) whose name matches `pattern`, outside SKIP_DIRS. */
function filesUnder(dir, pattern) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : filesUnder(full, pattern);
    return pattern.test(entry.name) ? [path.relative(root, full)] : [];
  });
}

const CODE_FILES = ['src', 'server', 'shared']
  .flatMap((dir) => filesUnder(path.join(root, dir), /\.(js|ts|tsx)$/))
  .filter((file) => !/\.test\.|\.d\.ts$/.test(file) && !ENUM_FILES.has(file));
const SQL_FILES = ['server', 'shared'].flatMap((dir) => filesUnder(path.join(root, dir), /\.sql$/));
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const isAllowed = (/** @type {string} */ file, /** @type {string} */ value) => (ALLOWED.get(file) ?? []).some((entry) => entry.values.includes(value));

describe('rawEnumValues', () => {
  it('finds enum values typed by hand, in code and in SQL', () => {
    expect(rawEnumValues("if (order.status === 'Open') return;")).toEqual([{ line: 1, value: 'Open' }]);
    expect(rawEnumValues('const sql = `SELECT 1\n  WHERE exchange = \'NFO\'`;')).toEqual([{ line: 1, value: 'NFO' }]);
    expect(rawEnumValues('<Chart optionType="CE" />')).toEqual([{ line: 1, value: 'CE' }]);
  });

  it('allows members, ${sqlEnum(…)}, other words, display labels, comments and CSS classes', () => {
    const source = [
      'if (order.status === OrderStatus.Open) return;',
      'const sql = `WHERE status = ${sqlEnum(OrderStatus.Open)} AND name = $1`;',
      "const label = 'Open orders';",
      "const option = { id: OrderStatus.Open, label: 'Open' };",
      "const LABELS = { [OrderStatus.Open]: 'Open' };",
      "// e.g. 'Open'",
      "<span className={`chip ${on ? 'active' : ''}`} />",
    ].join('\n');
    expect(rawEnumValues(source)).toEqual([]);
  });
});

describe('membersInStrings', () => {
  it('finds a member written into SQL text', () => {
    expect(membersInStrings('const sql = `SELECT 1\n  WHERE exchange = Exchange.NFO`;')).toEqual([{ line: 1, member: 'Exchange.NFO' }]);
    expect(membersInStrings("const s = 'side = Side.BUY';")).toEqual([{ line: 1, member: 'Side.BUY' }]);
  });

  it('allows members in code, in ${…} and in comments', () => {
    const source = [
      'const side = Side.BUY;',
      'const label = `${Exchange.NFO}:${row.symbol}`;',
      '// e.g. Exchange.NSE',
      "const sql = 'WHERE exchange = $1';",
    ].join('\n');
    expect(membersInStrings(source)).toEqual([]);
  });
});

describe('sqlEnumLiterals', () => {
  it('finds enum values quoted in SQL, not in comments or other words', () => {
    expect(sqlEnumLiterals("-- status 'Open'\nDELETE FROM orders WHERE status <> 'Open';")).toEqual([{ line: 2, value: 'Open' }]);
    expect(sqlEnumLiterals("DELETE FROM t WHERE run_date < to_char(now(), 'YYYY-MM-DD');")).toEqual([]);
  });
});

describe('unloweredClassModifiers', () => {
  it('finds a class modifier built from a value that is not lower-cased', () => {
    expect(unloweredClassModifiers('<span className={`badge badge--${tone}`} />')).toEqual([{ line: 1, expression: 'tone' }]);
    expect(unloweredClassModifiers('x\n<li className={`step--${stepTone(stage)}`} />')).toEqual([{ line: 2, expression: 'stepTone(stage)' }]);
  });

  it('allows lower-cased values, lower-case quoted words and listed helpers', () => {
    const source = [
      '<span className={`badge--${tone.toLowerCase()}`} />',
      "<span className={`chip--${on ? 'up' : 'down'}`} />",
      "<span className={`chip--${a === B.X ? 'rich' : a === B.Y ? 'cheap' : 'fair'}`} />",
      '<span className={`chip--${sideClass}`} />',
    ].join('\n');
    expect(unloweredClassModifiers(source, ['sideClass'])).toEqual([]);
  });
});

describe('the SQL files the app runs', () => {
  it('name no enum value (a job that needs one is a .js job using sqlEnum)', () => {
    expect(SQL_FILES.length).toBeGreaterThan(0);
    const offenders = SQL_FILES.flatMap((file) => sqlEnumLiterals(read(file)).map(({ line, value }) => `${file}:${line} '${value}'`));
    expect(offenders).toEqual([]);
  });
});

describe('the code', () => {
  it('types no enum value by hand', () => {
    const offenders = CODE_FILES.flatMap((file) => rawEnumValues(read(file))
      .filter(({ value }) => !isAllowed(file, value))
      .map(({ line, value }) => `${file}:${line} '${value}'`));
    expect(offenders).toEqual([]);
  });

  it('lower-cases every CSS class modifier built from a value', () => {
    const offenders = CODE_FILES.flatMap((file) => {
      const helpers = (CSS_WORD_HELPERS.get(file) ?? []).flatMap((entry) => entry.expressions);
      return unloweredClassModifiers(read(file), helpers).map(({ line, expression }) => `${file}:${line} --\${${expression}}`);
    });
    expect(offenders).toEqual([]);
  });

  it('writes no enum member inside string text', () => {
    const offenders = CODE_FILES.flatMap((file) => membersInStrings(read(file)).map(({ line, member }) => `${file}:${line} ${member}`));
    expect(offenders).toEqual([]);
  });
});
