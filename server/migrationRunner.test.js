import { describe, it, expect } from 'vitest';
import { BASE_SCHEMA_FILE, migrationChecksum, planMigrations, replacedMigration } from './migrationRunner.js';

const file = (name, sql = `-- ${name}`) => ({ name, sql, checksum: migrationChecksum(sql) });
const base = (replaces, body = 'CREATE TABLE a ();') => file(BASE_SCHEMA_FILE, `-- The base schema.\n-- replaces: ${replaces}\n${body}\n`);
const BASE = base('026_last.sql');
const NEXT = file('001_next.sql');
const applied = (...files) => new Map(files.map((f) => [f.name, f.checksum]));
const steps = (plan) => plan.map((step) => [step.action, step.file.name]);

describe('planMigrations', () => {
  it('runs the base file and everything after it on a new database', () => {
    expect(steps(planMigrations([BASE, NEXT], new Map()))).toEqual([['Run', BASE.name], ['Run', NEXT.name]]);
  });

  it('only records the base file on a database that has the migration it replaces, then runs the next', () => {
    expect(steps(planMigrations([BASE, NEXT], applied(file('001_init.sql'), file('026_last.sql')))))
      .toEqual([['Record', BASE.name], ['Run', NEXT.name]]);
  });

  it('refuses a database behind the base file', () => {
    // It lacks what the later replaced files built; the base file's IF NOT EXISTS would skip its existing tables.
    expect(() => planMigrations([BASE], applied(file('025_before_last.sql')))).toThrow('This database is behind 000_base_schema.sql');
  });

  it('skips what is applied', () => {
    expect(steps(planMigrations([BASE, NEXT], applied(BASE)))).toEqual([['Run', NEXT.name]]);
    expect(planMigrations([BASE, NEXT], applied(BASE, NEXT))).toEqual([]);
  });

  it('re-records a new squash on a database that has the migrations it folded in', () => {
    // A later squash: the base file now also holds 001_next.sql, whose file is deleted.
    const resquashed = base(NEXT.name, 'CREATE TABLE a (); CREATE TABLE b ();');
    expect(steps(planMigrations([resquashed], applied(BASE, NEXT)))).toEqual([['Record', BASE.name]]);
  });

  it('refuses a base file edited without folding in more migrations', () => {
    const edited = base('026_last.sql', 'CREATE TABLE changed ();');
    expect(() => planMigrations([edited], applied(BASE, NEXT))).toThrow('was modified after being applied');
  });

  it('refuses any other applied file that was edited', () => {
    const edited = { ...NEXT, checksum: migrationChecksum('-- changed') };
    expect(() => planMigrations([BASE, edited], applied(BASE, NEXT))).toThrow(`Migration ${NEXT.name} was modified after being applied`);
  });
});

describe('replacedMigration', () => {
  it("reads the base file's replaces line", () => {
    expect(replacedMigration(BASE)).toBe('026_last.sql');
  });

  it('requires the line', () => {
    const noLine = file(BASE_SCHEMA_FILE, 'CREATE TABLE a ();');
    expect(() => planMigrations([noLine], applied(file('026_last.sql')))).toThrow('needs a "-- replaces:');
    expect(() => planMigrations([noLine], new Map())).toThrow('needs a "-- replaces:');
  });
});
