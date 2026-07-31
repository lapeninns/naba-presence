const LOCALE = "en-GB"

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
