// Client-safe (no node:* imports): the comparison primitives every readback
// adapter in this directory shares. An adapter reads the live provider
// resource after a write, normalises both sides the way Google normalises
// what it stores, and compares only the fields the write's mask named.
// Hashing for baselines stays server-side (lib/server/gbp-management.ts
// stableGoogleHash); these modules only decide equality.

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * Text as Google stores it: CRLF folded to LF, trailing spaces on each line
 * and leading/trailing blank space dropped. Interior spacing is kept, so a
 * real edit to the words still compares unequal.
 */
export function normalizeText(value: unknown): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .trim()
}

/**
 * A link as Google echoes it: scheme and host lower-cased, default ports and
 * a bare trailing "/" dropped. Anything that does not parse compares as its
 * trimmed text.
 */
export function normalizeUri(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed
  }
  const port =
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
      ? ""
      : url.port
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "")
  return `${url.protocol}//${url.hostname.toLowerCase()}${port ? `:${port}` : ""}${path}${url.search}${url.hash}`
}

/** Null, undefined, "" (after trimming), [] and {} all mean "not set". */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.values(value).every(isEmptyValue)
  return false
}

/**
 * True when `actual` holds everything `expected` asks for. Keys `expected`
 * does not name are ignored (Google adds output-only and derived fields),
 * arrays compare element by element in order, strings compare as
 * normalised text, and an empty expected value matches an absent one. A
 * `false` is a value: it never matches an absent field, the distinction
 * between "no" and "not set" that attributes and lodging depend on.
 */
export function containsExpected(actual: unknown, expected: unknown): boolean {
  if (!isRecord(expected) && isEmptyValue(expected)) {
    return isEmptyValue(actual)
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => containsExpected(actual[index], item))
    )
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return isEmptyValue(expected) && isEmptyValue(actual)
    if (isTimeOfDay(expected)) {
      return normalizeTimeOfDay(actual) === normalizeTimeOfDay(expected)
    }
    return Object.entries(expected).every(([key, value]) =>
      containsExpected(actual[key], value)
    )
  }
  if (typeof expected === "string") {
    return (
      typeof actual === "string" &&
      normalizeText(actual) === normalizeText(expected)
    )
  }
  return actual === expected
}

/** The value at a dotted field path (`policies.checkinTime`), if any. */
export function valueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

/** The two sets hold the same members, ignoring order and duplicates. */
export function sameSet(left: Iterable<string>, right: Iterable<string>) {
  const a = new Set(left)
  const b = new Set(right)
  return a.size === b.size && [...a].every((item) => b.has(item))
}

const TIME_OF_DAY_KEYS = new Set(["hours", "minutes", "seconds", "nanos"])

/** A record shaped like a Google TimeOfDay (only its four numeric parts). */
export function isTimeOfDay(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length > 0 &&
    keys.every(
      (key) => TIME_OF_DAY_KEYS.has(key) && typeof value[key] === "number"
    )
  )
}

/**
 * A Google TimeOfDay with its omitted parts filled in: Google drops zero
 * minutes/seconds/nanos from what it echoes.
 */
export function normalizeTimeOfDay(value: unknown): string | null {
  if (!isRecord(value)) return null
  const part = (key: string) => {
    const raw = value[key]
    return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0
  }
  return [part("hours"), part("minutes"), part("seconds"), part("nanos")].join(
    ":"
  )
}

/** A Google Date ({year, month, day}) as one comparable string. */
export function normalizeDate(value: unknown): string | null {
  if (!isRecord(value)) return null
  const part = (key: string) => {
    const raw = value[key]
    return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0
  }
  return [part("year"), part("month"), part("day")].join("-")
}
