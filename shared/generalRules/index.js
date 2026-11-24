/**
 * General rules: the account's own rules, over every strategy, set once (the Trading Strategies page's "All
 * strategies" section). Each is an entry rule (checked before a strategy's own entry rules) or an exit rule (checked
 * after a strategy's own exit rules); the rule lists in entryRules/ and exitRules/ run them.
 */
import maxOpenPositions from './maxOpenPositions.js';
import maxDailyLoss from './maxDailyLoss.js';

/** Checked on every strategy's trades before its own entry rules. @type {import('../entryRules/index.js').EntryRule[]} */
export const GENERAL_ENTRY_RULES = [maxOpenPositions];

/** Checked on every automated position after its strategy's own exit rules. @type {import('../exitRules/index.js').ExitRule[]} */
export const GENERAL_EXIT_RULES = [maxDailyLoss];

/** Every general rule, as the settings show and store them. */
export const GENERAL_RULES = [...GENERAL_ENTRY_RULES, ...GENERAL_EXIT_RULES];
