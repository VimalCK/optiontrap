/**
 * The browser screens' own value sets as enums: colour tones, toasts, the
 * accent theme, and each screen's tabs and views. Like shared/tradeEnums.js,
 * code names a member (`Tone.Positive`), never a raw string, and each value is
 * its member's name, so the URL (?tab=Journal) and storage read the same as
 * the code.
 *
 * Where a value becomes a CSS class or attribute, the screen lower-cases it
 * (`badge--${tone.toLowerCase()}`), so the stylesheets keep their lower-case
 * names. Sets the server or the database also use live in shared/*Enums.js.
 * shared/enumGuards.test.js checks this file with those.
 */

/** A value's colour on a badge or a figure: profit, loss, the accent, or plain. */
export const Tone = Object.freeze({ Positive: 'Positive', Negative: 'Negative', Accent: 'Accent', Neutral: 'Neutral' });
export type ToneId = typeof Tone[keyof typeof Tone];

/** A message box's kind (Message): something failed, or a plain notice. */
export const MessageTone = Object.freeze({ Error: 'Error', Info: 'Info' });
export type MessageToneId = typeof MessageTone[keyof typeof MessageTone];

/** A guide row's chip colour (InfoGuide). */
export const GuideTone = Object.freeze({ Bull: 'Bull', Bear: 'Bear', Warn: 'Warn', Violet: 'Violet', Accent: 'Accent', Muted: 'Muted', Plain: 'Plain' });
export type GuideToneId = typeof GuideTone[keyof typeof GuideTone];

/** A health badge's state on Admin Health: up, down, a warning, or idle (not running). */
export const HealthTone = Object.freeze({ Up: 'Up', Down: 'Down', Warn: 'Warn', Idle: 'Idle' });
export type HealthToneId = typeof HealthTone[keyof typeof HealthTone];

/** A toast's colour: done (green) or refused / failed (red). */
export const ToastColor = Object.freeze({ Green: 'Green', Red: 'Red' });
export type ToastColorId = typeof ToastColor[keyof typeof ToastColor];

/** The accent colour the user picks in Settings. */
export const AccentTheme = Object.freeze({ Indigo: 'Indigo', Emerald: 'Emerald', Amber: 'Amber', Rose: 'Rose', Cyan: 'Cyan', Violet: 'Violet' });
export type AccentThemeId = typeof AccentTheme[keyof typeof AccentTheme];

/** Admin's tabs (?tab=). */
export const AdminTab = Object.freeze({ Feedback: 'Feedback', Users: 'Users', Diagnostics: 'Diagnostics' });
export type AdminTabId = typeof AdminTab[keyof typeof AdminTab];

/** Analytics' tabs (?tab=). */
export const AnalyticsTab = Object.freeze({ History: 'History', Analyzer: 'Analyzer', Journal: 'Journal', WinLoss: 'WinLoss' });
export type AnalyticsTabId = typeof AnalyticsTab[keyof typeof AnalyticsTab];

/** The trade journal range a link can open with (?range=). */
export const JournalRange = Object.freeze({ Today: 'Today' });
export type JournalRangeId = typeof JournalRange[keyof typeof JournalRange];

/** Portfolio's tabs (?tab=). */
export const PortfolioTab = Object.freeze({ Holdings: 'Holdings', Positions: 'Positions' });
export type PortfolioTabId = typeof PortfolioTab[keyof typeof PortfolioTab];

/** How Holdings draws its allocation. */
export const AllocationView = Object.freeze({ Bar: 'Bar', Treemap: 'Treemap' });
export type AllocationViewId = typeof AllocationView[keyof typeof AllocationView];

/** The paper positions card's tabs. */
export const PaperTab = Object.freeze({ Positions: 'Positions', Orders: 'Orders', Risk: 'Risk' });
export type PaperTabId = typeof PaperTab[keyof typeof PaperTab];

/** Kite's two live position lists: net, or today's. */
export const LiveView = Object.freeze({ Net: 'Net', Day: 'Day' });
export type LiveViewId = typeof LiveView[keyof typeof LiveView];

/** Algo Trading settings sections (?tab=). */
export const AutomationSettingsSection = Object.freeze({ General: 'General', Strategies: 'Strategies', EntryRules: 'EntryRules', ExitRules: 'ExitRules' });
export type AutomationSettingsSectionId = typeof AutomationSettingsSection[keyof typeof AutomationSettingsSection];

/** The trap analyzer's views: one strike, or the map of all. */
export const AnalyzerView = Object.freeze({ Single: 'Single', Map: 'Map' });
export type AnalyzerViewId = typeof AnalyzerView[keyof typeof AnalyzerView];

/** OI History's futures context: a table or a chart. */
export const FuturesView = Object.freeze({ Table: 'Table', Chart: 'Chart' });
export type FuturesViewId = typeof FuturesView[keyof typeof FuturesView];

/** OI History's analysis tabs: the strike's history, or the trade setup. */
export const OiHistoryTab = Object.freeze({ History: 'History', Setup: 'Setup' });
export type OiHistoryTabId = typeof OiHistoryTab[keyof typeof OiHistoryTab];

/** The stock setups panel's views. */
export const StockSetupsView = Object.freeze({ Details: 'Details', Guide: 'Guide', Scorecard: 'Scorecard' });
export type StockSetupsViewId = typeof StockSetupsView[keyof typeof StockSetupsView];

/** The "every segment" choice of a segment filter. */
export const AnySegment = Object.freeze({ All: 'All' });
export type AnySegmentId = typeof AnySegment[keyof typeof AnySegment];

/** A value with its letters and digits only, lower-cased, so `entry-rules`, `EntryRules` and `entryrules` compare equal. */
const paramKey = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * The enum value a URL parameter names, or `fallback` (which may be undefined). Matching ignores case and
 * punctuation, so links saved before the enum (`?tab=winloss`, `?tab=entry-rules`)
 * still open the same tab.
 */
export function enumFromParam<T extends string, F extends T | undefined>(values: Readonly<Record<string, T>>, param: string | null, fallback: F): T | F {
  if (param == null) return fallback;
  const key = paramKey(param);
  return Object.values(values).find((value) => paramKey(value) === key) ?? fallback;
}
