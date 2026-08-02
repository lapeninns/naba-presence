import { formatNumber } from "@/lib/format"

// Google returns exact impressions for high-volume keywords and a lower-bounded
// range for low-volume ones (thresholded). Present the range honestly as "N+"
// (at least N) rather than inventing a precise-looking number.
export function formatKeywordImpressions(kw: {
  impressions: number
  upperBound: number
  thresholded: boolean
}): string {
  if (kw.thresholded) return `${formatNumber(kw.impressions)}+`
  return formatNumber(kw.impressions)
}
