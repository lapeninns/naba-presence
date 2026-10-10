export type OpeningDateDraft = { year: string; month: string; day: string }

export function openingDateDraft(value: unknown): OpeningDateDraft | undefined {
  if (!value || typeof value !== "object") return undefined
  return {
    year: "year" in value && typeof value.year === "number" ? String(value.year) : "",
    month: "month" in value && typeof value.month === "number" ? String(value.month) : "",
    day: "day" in value && typeof value.day === "number" ? String(value.day) : "",
  }
}

export function openingDatePayload(value: OpeningDateDraft) {
  return { year: Number(value.year), month: Number(value.month), ...(value.day.trim() ? { day: Number(value.day) } : {}) }
}

export function openingDateLabel(value: OpeningDateDraft | null | undefined): string {
  if (!value) return "Not set"
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(value.month) - 1]
  return `${value.day && value.day !== "0" ? `${value.day} ` : ""}${month ?? value.month} ${value.year}`.trim()
}
