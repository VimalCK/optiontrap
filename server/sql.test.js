import { describe, expect, it } from 'vitest';
import { sqlEnum, sqlEnumList } from './sql.js';
import { Exchange, OptionType, OrderStatus } from '../shared/tradeEnums.js';
import { JobRunStatus } from '../shared/appEnums.js';

describe('sqlEnum', () => {
  it('quotes an enum value as a SQL literal', () => {
    expect(sqlEnum(Exchange.NFO)).toBe("'NFO'");
    expect(sqlEnum(OrderStatus.Open)).toBe("'Open'");
    expect(sqlEnum(JobRunStatus.Failed)).toBe("'Failed'");
  });

  it('lists enum values for IN (…)', () => {
    expect(sqlEnumList(OptionType.CE, OptionType.PE)).toBe("'CE', 'PE'");
  });

  it('refuses anything that is not an enum value', () => {
    expect(() => sqlEnum('NFOX')).toThrow('not an enum value');
    expect(() => sqlEnum("open' OR '1'='1")).toThrow('not an enum value');
    expect(() => sqlEnum(/** @type {any} */ (undefined))).toThrow('not an enum value');
    expect(() => sqlEnumList(OptionType.CE, 'XX')).toThrow('not an enum value');
  });
});
