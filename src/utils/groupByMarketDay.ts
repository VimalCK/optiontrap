import { marketDate } from '../../shared/marketTime.js';

export interface MarketDayGroup<Item> {
  /** YYYY-MM-DD, IST. */
  day: string;
  items: Item[];
}

/** Groups items by the IST day of `timeOf`, in the order the items come (newest first when they do). */
export function groupByMarketDay<Item>(items: Item[], timeOf: (item: Item) => string): MarketDayGroup<Item>[] {
  const groups: MarketDayGroup<Item>[] = [];
  for (const item of items) {
    const day = marketDate(new Date(timeOf(item)));
    let group = groups.find((g) => g.day === day);
    if (!group) {
      group = { day, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
