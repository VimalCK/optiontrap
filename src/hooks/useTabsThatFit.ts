import { useLayoutEffect, useState, type RefObject } from 'react';

/** Room kept for a tab growing on hover (its delete button opens out). */
const HOVER_SLACK = 24;

/**
 * Which tabs of a one-line tab bar fit in its row, so the rest can go in a "+N" menu.
 *
 * - `row`: the space the bar may fill.
 * - `measure`: a hidden copy of the bar (same classes) holding every tab, then a
 *   "+N" button as its last child; it gives each tab's natural width.
 * - `trailing`: controls after the tabs that always show (e.g. the "+" new-list button).
 *
 * The active tab always stays visible: it takes the place after the leading tabs
 * that fit. With `activeIndex` -1 (no active item) none has to stay.
 * `maxVisible` caps how many show even when more would fit.
 * Returns the indexes to show, or null (show all) until measured.
 */
export function useTabsThatFit(
  row: RefObject<HTMLElement | null>,
  measure: RefObject<HTMLElement | null>,
  trailing: RefObject<HTMLElement | null>,
  activeIndex: number,
  maxVisible = Infinity,
): Set<number> | null {
  const [visible, setVisible] = useState<Set<number> | null>(null);
  // The elements, checked after every render: a bar that first renders nothing
  // (e.g. until its data loads) gets measured once they appear.
  const [elements, setElements] = useState<(HTMLElement | null)[]>([null, null, null]);
  useLayoutEffect(() => {
    const now = [row.current, measure.current, trailing.current];
    if (now.some((el, i) => el !== elements[i])) setElements(now);
  });
  const [rowEl, measureEl, trailingEl] = elements;

  useLayoutEffect(() => {
    if (!rowEl || !measureEl) return;

    const compute = () => {
      const children = [...measureEl.children] as HTMLElement[];
      const moreWidth = children.pop()?.offsetWidth ?? 0;
      const widths = children.map((el) => el.offsetWidth);
      const gap = parseFloat(getComputedStyle(measureEl).columnGap) || 0;
      const allItems = [...widths, moreWidth];
      // Padding and border of the bar itself.
      const chrome = measureEl.offsetWidth - allItems.reduce((a, b) => a + b, 0) - gap * (allItems.length - 1);
      const trailingWidth = trailingEl ? trailingEl.offsetWidth + gap : 0;
      const available = rowEl.clientWidth - trailingWidth - HOVER_SLACK;
      const barWidth = (items: number[]) => chrome + items.reduce((a, b) => a + b, 0) + gap * Math.max(items.length - 1, 0);

      if (widths.length <= maxVisible && barWidth(widths) <= available) {
        setVisible((prev) => (prev && prev.size === widths.length ? prev : new Set(widths.map((_, i) => i))));
        return;
      }
      // Leading tabs plus the active one (if it is further on), plus the "+N" button.
      // With no active item, nothing need show: everything can go under "+N".
      let best = new Set<number>(activeIndex >= 0 ? [activeIndex] : []);
      for (let lead = 1; lead <= Math.min(widths.length, maxVisible); lead++) {
        const shown = new Set<number>(Array.from({ length: lead }, (_, i) => i));
        if (activeIndex >= 0) shown.add(activeIndex);
        if (shown.size >= widths.length) break;
        if (barWidth([...[...shown].map((i) => widths[i]), moreWidth]) > available) break;
        best = shown;
      }
      setVisible((prev) => (prev && prev.size === best.size && [...best].every((i) => prev.has(i)) ? prev : best));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(rowEl);
    observer.observe(measureEl);
    if (trailingEl) observer.observe(trailingEl);
    return () => observer.disconnect();
  }, [rowEl, measureEl, trailingEl, activeIndex, maxVisible]);

  return visible;
}
