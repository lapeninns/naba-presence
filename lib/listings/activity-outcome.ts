/**
 * How one recorded Google change attempt reads: the word and the tone. One
 * helper, so the same outcome is never amber in one place and red in
 * another. A failure is danger; an attempt whose outcome Google never
 * confirmed ("ambiguous") is a warning: it may have landed.
 */

export type ActivityTone = "success" | "warning" | "danger" | "neutral"

export function activityTone(status: string): ActivityTone {
  switch (status) {
    case "succeeded":
      return "success"
    case "failed":
      return "danger"
    case "ambiguous":
      return "warning"
    default:
      return "neutral"
  }
}

/** The same tone in the status pill's vocabulary. */
export function activityPillTone(
  status: string
): "ok" | "warn" | "bad" | "outline" {
  const tone = activityTone(status)
  return tone === "success"
    ? "ok"
    : tone === "warning"
      ? "warn"
      : tone === "danger"
        ? "bad"
        : "outline"
}

/** "publish_food_menus" → "Publish food menus". */
export function humaniseActivity(value: string): string {
  const lower = value.toLowerCase().replace(/[_-]+/g, " ").trim()
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : value
}

export function activityStatusLabel(status: string): string {
  switch (status) {
    case "succeeded":
      return "Succeeded"
    case "failed":
      return "Failed"
    case "ambiguous":
      return "Outcome unclear"
    default:
      return humaniseActivity(status)
  }
}
