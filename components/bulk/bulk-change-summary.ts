/**
 * What one listing's bulk change does, in the approver's words.
 *
 * Derived only from the child's frozen `currentValue`, `proposedValue` and
 * `updateMask` (plus the child's own change for the action-link type), so
 * the approver reads exactly what will be sent to that listing, not the
 * request in general. Pure and client-safe.
 */
import type { BulkChild } from "@/lib/contracts/bulk-listings"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"

export type ChangeRow = {
  /** What changes: a date, a day, a service-hours type, an attribute, a link. */
  label: string
  current: string
  proposed: string
}

type GoogleTime = { hours?: number; minutes?: number }
type GoogleDate = { year?: number; month?: number; day?: number }
type Period = {
  openDay?: string
  closeDay?: string
  openTime?: GoogleTime
  closeTime?: GoogleTime
}
type SpecialPeriod = {
  startDate?: GoogleDate
  openTime?: GoogleTime
  closeTime?: GoogleTime
  closed?: boolean
}

const WEEK = [
  ["MONDAY", "Monday"],
  ["TUESDAY", "Tuesday"],
  ["WEDNESDAY", "Wednesday"],
  ["THURSDAY", "Thursday"],
  ["FRIDAY", "Friday"],
  ["SATURDAY", "Saturday"],
  ["SUNDAY", "Sunday"],
] as const

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const list = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : []

/** Google omits zero fields: `{}` is midnight, `{ hours: 9 }` is 09:00. */
function time(value: GoogleTime | undefined): string {
  const hours = value?.hours ?? 0
  const minutes = value?.minutes ?? 0
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}
const span = (period: { openTime?: GoogleTime; closeTime?: GoogleTime }) =>
  `${time(period.openTime)}–${time(period.closeTime)}`

function dateKey(value: GoogleDate | undefined): string | null {
  return value?.year && value.month && value.day
    ? `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`
    : null
}
function dateLabel(key: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key}T00:00:00Z`))
}

/** "HAPPY_HOURS" → "Happy hours"; "attributes/has_wifi" → "Has wifi". */
export function humaniseId(id: string): string {
  const tail = id.split("/").pop() ?? id
  const words = tail
    .replace(/[_.:-]+/g, " ")
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id
}

/** Each weekday's periods, "Closed" when it has none. */
function weekly(periods: readonly Period[]): Map<string, string> {
  const days = new Map<string, string>()
  for (const [key, name] of WEEK) {
    const spans = periods.filter((period) => period.openDay === key).map(span)
    days.set(name, spans.length ? spans.join(", ") : "Closed")
  }
  return days
}
function weeklyText(periods: readonly Period[]): string {
  if (!periods.length) return "None"
  return [...weekly(periods)]
    .filter(([, value]) => value !== "Closed")
    .map(([day, value]) => `${day.slice(0, 3)} ${value}`)
    .join("; ")
}

function regularHoursRows(current: unknown, proposed: unknown): ChangeRow[] {
  const before = weekly(list<Period>(record(current).periods))
  const after = weekly(list<Period>(record(proposed).periods))
  return WEEK.flatMap(([, day]) => {
    const from = before.get(day) ?? "Closed"
    const to = after.get(day) ?? "Closed"
    return from === to ? [] : [{ label: day, current: from, proposed: to }]
  })
}

function specialValue(period: SpecialPeriod | undefined): string {
  if (!period) return "Not set"
  if (period.closed) return "Closed"
  return `Open ${span(period)}`
}
function specialHoursRows(current: unknown, proposed: unknown): ChangeRow[] {
  const index = (value: unknown) => {
    const map = new Map<string, SpecialPeriod>()
    for (const period of list<SpecialPeriod>(
      record(value).specialHourPeriods
    )) {
      const key = dateKey(period.startDate)
      if (key) map.set(key, period)
    }
    return map
  }
  const before = index(current)
  const after = index(proposed)
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((key) => {
      const from = specialValue(before.get(key))
      const to = specialValue(after.get(key))
      return from === to
        ? []
        : [{ label: dateLabel(key), current: from, proposed: to }]
    })
}

function moreHoursRows(current: unknown, proposed: unknown): ChangeRow[] {
  type Entry = { hoursTypeId?: string; periods?: Period[] }
  const index = (value: unknown) =>
    new Map(
      list<Entry>(value).flatMap((entry) =>
        entry.hoursTypeId
          ? [[entry.hoursTypeId, weeklyText(entry.periods ?? [])] as const]
          : []
      )
    )
  const before = index(current)
  const after = index(proposed)
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((type) => {
      const from = before.get(type) ?? "None"
      const to = after.get(type) ?? "None"
      return from === to
        ? []
        : [{ label: humaniseId(type), current: from, proposed: to }]
    })
}

function attributeValue(values: unknown): string {
  const items = list<unknown>(values)
  if (!items.length) return "Not set"
  return items
    .map((value) =>
      value === true
        ? "Yes"
        : value === false
          ? "No"
          : typeof value === "string"
            ? humaniseId(value)
            : String(value)
    )
    .join(", ")
}
function attributeRows(
  current: unknown,
  proposed: unknown,
  mask: readonly string[]
): ChangeRow[] {
  type Attribute = { name?: string; values?: unknown[] }
  const index = (value: unknown) =>
    new Map(
      list<Attribute>(value).flatMap((attribute) =>
        attribute.name ? [[attribute.name, attribute.values] as const] : []
      )
    )
  const before = index(current)
  const after = index(proposed)
  const names = mask.length ? mask : [...after.keys()]
  return names.map((name) => ({
    label: humaniseId(name),
    current: attributeValue(before.get(name)),
    proposed: attributeValue(after.get(name)),
  }))
}

function placeActionRows(
  current: unknown,
  proposed: unknown,
  input: BulkChild["input"]
): ChangeRow[] {
  type Link = { name?: string; uri?: string; isPreferred?: boolean }
  const links = list<Link>(current)
  const type =
    input.operation === "place_action"
      ? actionTypeLabel(input.placeActionType)
      : "Action link"
  const describe = (link: { uri?: string; isPreferred?: boolean }) =>
    `${link.uri ?? "link"}${link.isPreferred ? " (preferred)" : ""}`
  const change = record(proposed)
  if (typeof change.delete === "string") {
    const target = links.find((link) => link.name === change.delete)
    return [
      {
        label: type,
        current: target ? describe(target) : "An existing link",
        proposed: "Removed",
      },
    ]
  }
  const payload = record(change.create ?? change.payload) as Link
  if (typeof change.update === "string") {
    const target = links.find((link) => link.name === change.update)
    return [
      {
        label: type,
        current: target ? describe(target) : "An existing link",
        proposed: describe(payload),
      },
    ]
  }
  return [
    {
      label: type,
      current: links.length
        ? links.map(describe).join(", ")
        : "No link for this button",
      proposed: `Add ${describe(payload)}`,
    },
  ]
}

/** The listing's exact change, one row per thing that differs. */
export function describeChildChange(
  child: Pick<
    BulkChild,
    "operation" | "input" | "currentValue" | "proposedValue" | "updateMask"
  >
): ChangeRow[] {
  if (child.proposedValue === null || child.proposedValue === undefined)
    return []
  const { currentValue: current, proposedValue: proposed, input } = child
  switch (child.operation) {
    case "regular_hours":
      return regularHoursRows(current, proposed)
    case "special_hours":
      return specialHoursRows(current, proposed)
    case "more_hours":
      return moreHoursRows(current, proposed)
    case "attributes":
      return attributeRows(current, proposed, child.updateMask)
    case "place_action":
      return placeActionRows(current, proposed, input)
    case "business_info":
      return fieldRows(current, proposed, BUSINESS_FIELD_LABEL)
    case "categories":
      return categoryRows(current, proposed)
    case "lodging":
      return fieldRows(current, proposed)
    case "food_menus":
      return menuRows(current, proposed)
    case "post_draft":
      return postRows(proposed)
    case "photos":
      return photoRows(current, proposed)
    // A review child carries no listing value: its review and reply are
    // shown from its outcome code.
    case "review_approval":
    case "review_template_reply":
      return []
  }
}

const KIND_LABEL: Record<string, string> = {
  menu: "Menu",
  section: "Section",
  item: "Item",
}
type MenuNodeSummary = {
  kind?: string
  label?: string
  within?: string[]
  contains?: number
  fields?: string[]
}
/** "Item “Soup” in Lunch › Starters (and 3 more entries)". */
function menuNode(node: MenuNodeSummary): string {
  const kind = KIND_LABEL[node.kind ?? ""] ?? "Entry"
  const name = node.label
    ? `${kind} “${node.label}”`
    : `Unnamed ${kind.toLowerCase()}`
  const place = (node.within ?? []).filter(Boolean)
  const where = place.length ? ` in ${place.join(" › ")}` : ""
  const more = node.contains
    ? ` (with ${node.contains} ${node.contains === 1 ? "entry" : "entries"} inside)`
    : ""
  return `${name}${where}${more}`
}
type MenuCounts = { menus?: number; sections?: number; items?: number }
const menuCounts = (counts: MenuCounts | undefined) =>
  `${counts?.menus ?? 0} menus, ${counts?.sections ?? 0} sections, ${counts?.items ?? 0} items`

/**
 * Menus: every entry the listing loses is its own row, so the approver sees
 * each removal before approving; then additions and updates.
 */
function menuRows(current: unknown, proposed: unknown): ChangeRow[] {
  const before = record(current) as { counts?: MenuCounts }
  const after = record(proposed) as {
    counts?: MenuCounts
    removed?: MenuNodeSummary[]
    added?: MenuNodeSummary[]
    updated?: MenuNodeSummary[]
  }
  return [
    ...list<MenuNodeSummary>(after.removed).map((node) => ({
      label: "Removed",
      current: menuNode(node),
      proposed: "Removed from Google",
    })),
    ...list<MenuNodeSummary>(after.added).map((node) => ({
      label: "Added",
      current: "Not on Google",
      proposed: menuNode(node),
    })),
    ...list<MenuNodeSummary>(after.updated).map((node) => ({
      label: "Updated",
      current: menuNode(node),
      proposed: `New ${(node.fields ?? []).map(humaniseId).join(", ").toLowerCase()}`,
    })),
    {
      label: "Menus",
      current: menuCounts(before.counts),
      proposed: menuCounts(after.counts),
    },
  ]
}

const TOPIC_LABEL: Record<string, string> = {
  STANDARD: "Update",
  EVENT: "Event",
  OFFER: "Offer",
}
/** A draft is created; it is published from the listing's posts. */
function postRows(proposed: unknown): ChangeRow[] {
  const post = record(proposed) as { topicType?: string; summary?: string }
  return [
    {
      label: "New post draft",
      current: "Nothing published",
      proposed: `${TOPIC_LABEL[post.topicType ?? ""] ?? "Post"} draft: ${post.summary || "(no text)"}`,
    },
  ]
}

/** "New photo (Interior): bar.jpg, 1200 × 800". */
function photoRows(current: unknown, proposed: unknown): ChangeRow[] {
  const photo = record(proposed) as {
    fileName?: string
    category?: string
    width?: number
    height?: number
    description?: string | null
  }
  const before = record(current) as { previousMediaName?: string | null }
  const category = (photo.category ?? "ADDITIONAL")
    .toLowerCase()
    .replaceAll("_", " ")
  const size =
    photo.width && photo.height ? `, ${photo.width} × ${photo.height}` : ""
  return [
    {
      label: `New photo (${category.charAt(0).toUpperCase()}${category.slice(1)})`,
      current: before.previousMediaName
        ? "Added before, since removed on Google"
        : "Not on this listing",
      proposed: `${photo.fileName ?? "Photo"}${size}${photo.description ? `: ${photo.description}` : ""}`,
    },
  ]
}

const BUSINESS_FIELD_LABEL: Record<string, string> = {
  websiteUri: "Website",
  "profile.description": "Description",
  labels: "Labels",
  "openInfo.status": "Open status",
}
const OPEN_STATUS: Record<string, string> = {
  OPEN: "Open",
  CLOSED_TEMPORARILY: "Temporarily closed",
  CLOSED_PERMANENTLY: "Permanently closed",
}

/** A frozen field value in words; null and empty are "Not set" (a clear). */
function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set"
  if (value === true) return "Yes"
  if (value === false) return "No"
  if (typeof value === "string") return OPEN_STATUS[value] ?? value
  if (Array.isArray(value))
    return value.length ? value.map(fieldValue).join(", ") : "Not set"
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length
      ? entries
          .map(([key, entry]) => `${humaniseId(key)}: ${fieldValue(entry)}`)
          .join("; ")
      : "Not set"
  }
  return String(value)
}

/** Field-mask families: one row per changed path (`false` reads "No", never "Not set"). */
function fieldRows(
  current: unknown,
  proposed: unknown,
  labels: Record<string, string> = {}
): ChangeRow[] {
  const before = record(current)
  return Object.entries(record(proposed)).map(([path, value]) => ({
    label: labels[path] ?? path.split(".").map(humaniseId).join(" › "),
    current: fieldValue(before[path]),
    proposed: fieldValue(value),
  }))
}

/** "categories/gcid:pub" → "Pub". */
export const categoryLabel = (name: string) =>
  humaniseId(name.replace(/^categories\/gcid:/, ""))

function categoryRows(current: unknown, proposed: unknown): ChangeRow[] {
  type Ids = { primary?: string | null; additional?: string[] }
  const before = record(current) as Ids
  const after = record(proposed) as Ids
  const names = (values: string[] | undefined) =>
    values?.length ? values.map(categoryLabel).join(", ") : "None"
  const rows: ChangeRow[] = []
  if (before.primary !== after.primary)
    rows.push({
      label: "Primary category",
      current: before.primary ? categoryLabel(before.primary) : "None",
      proposed: after.primary ? categoryLabel(after.primary) : "None",
    })
  if (names(before.additional) !== names(after.additional))
    rows.push({
      label: "Additional categories",
      current: names(before.additional),
      proposed: names(after.additional),
    })
  return rows
}

const MASK_LABEL: Record<string, string> = {
  websiteUri: "Website",
  profile: "Description",
  labels: "Labels",
  "openInfo.status": "Open status",
  categories: "Categories",
  regularHours: "Opening hours",
  specialHours: "Special hours",
  moreHours: "Service hours",
  menus: "Menus",
  localPost: "A new post draft",
}

/** An update mask entry in plain English, never the raw field path. */
export function maskLabel(mask: string): string {
  if (MASK_LABEL[mask]) return MASK_LABEL[mask]
  if (mask.startsWith("attributes/")) return humaniseId(mask)
  if (mask.includes("placeActionLinks/")) return "An existing action link"
  return humaniseId(mask)
}
