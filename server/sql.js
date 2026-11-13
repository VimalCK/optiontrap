/**
 * Postgres still receives the literal itself, which partial indexes need: one built `WHERE status = 'Open'` is used
 * only when the query states the same literal, which a $n parameter can't promise. The one exception to "$n
 * parameters only": it accepts only enum values (plain letters), never input, and throws on anything else.
 */
import * as tradeEnums from '../shared/tradeEnums.js';
import * as appEnums from '../shared/appEnums.js';

/** Every value an enum defines: the members of the exported frozen objects. */
const ENUM_VALUES = new Set(
  Object.values({ ...tradeEnums, ...appEnums })
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value) && Object.isFrozen(value))
    .flatMap((members) => Object.values(members)),
);

/**
 * An enum value as a quoted SQL literal: `sqlEnum(Exchange.NFO)` → `'NFO'`.
 * @param {string} value  an enum member
 */
export function sqlEnum(value) {
  if (!ENUM_VALUES.has(value) || !/^[A-Za-z]+$/.test(value)) throw new Error(`sqlEnum: not an enum value: ${String(value)}`);
  return `'${value}'`;
}

/**
 * Enum values as a SQL list for IN (…): `sqlEnumList(OptionType.CE, OptionType.PE)` → `'CE', 'PE'`.
 * @param {...string} values  enum members
 */
export const sqlEnumList = (...values) => values.map(sqlEnum).join(', ');
