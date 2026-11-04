/** A rupee amount in Indian grouping, always with two decimals: 41,949.50. */
export function formatAmount(value: number): string {
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** formatAmount with a + in front of gains: +41,949.50, -1,200.00. */
export function formatSignedAmount(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatAmount(value)}`;
}
