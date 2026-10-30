// Parts adapted from OpenGMB packages/core/src/review-links/pure.ts
// (isLikelyBot, the click source). Adapted from OpenGMB (MIT, © 2026 Synectus Private Limited).

/**
 * Review links: a short, tracked link per venue that sends a guest to
 * Google's own "write a review" form. Pure and client-safe.
 *
 * A link is `/r/<code>`. The code is random and unguessable (10 characters
 * from a 31-letter alphabet with no look-alikes: about 49 bits), so the
 * public route cannot be walked to find venues; it is printed on table
 * talkers, so it is not a secret either. Rotating a link replaces its code
 * and the old one stops working.
 *
 * The destination is always Google's `metadata.newReviewUri` as read from
 * the listing. It is never built by hand from a place id.
 */

export const REVIEW_LINK_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
export const REVIEW_LINK_CODE_LENGTH = 10
export const REVIEW_LINK_CODE_PATTERN = /^[2-9a-hjkmnp-z]{10}$/

/** The largest multiple of the alphabet's size below 256: bytes from here up are discarded. */
const UNBIASED_LIMIT =
  Math.floor(256 / REVIEW_LINK_CODE_ALPHABET.length) *
  REVIEW_LINK_CODE_ALPHABET.length

function cryptoRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

/**
 * A fresh code. Rejection sampling keeps every letter equally likely: a
 * plain `byte % 31` would favour the first eight letters.
 */
export function generateReviewLinkCode(
  randomBytes: (length: number) => Uint8Array = cryptoRandomBytes
): string {
  let code = ""
  while (code.length < REVIEW_LINK_CODE_LENGTH) {
    for (const byte of randomBytes(REVIEW_LINK_CODE_LENGTH * 2)) {
      if (byte >= UNBIASED_LIMIT) continue
      code += REVIEW_LINK_CODE_ALPHABET[byte % REVIEW_LINK_CODE_ALPHABET.length]
      if (code.length === REVIEW_LINK_CODE_LENGTH) break
    }
  }
  return code
}

/**
 * Whether a string could be a code at all. Anything else is refused before
 * it costs a database round trip, with the same neutral page.
 */
export function isReviewLinkCode(value: unknown): value is string {
  return typeof value === "string" && REVIEW_LINK_CODE_PATTERN.test(value)
}

/** Where an open came from: the printed QR code, or the link itself. */
export const REVIEW_LINK_SOURCES = ["link", "qr"] as const
export type ReviewLinkSource = (typeof REVIEW_LINK_SOURCES)[number]

export const REVIEW_LINK_SOURCE_PARAM = "s"

export function parseReviewLinkSource(
  value: string | null | undefined
): ReviewLinkSource {
  return value === "qr" ? "qr" : "link"
}

export const REVIEW_LINK_PATH = "/r/"

export function reviewLinkPath(
  code: string,
  source: ReviewLinkSource = "link"
): string {
  const path = `${REVIEW_LINK_PATH}${code}`
  return source === "qr" ? `${path}?${REVIEW_LINK_SOURCE_PARAM}=qr` : path
}

export function reviewLinkUrl(
  code: string,
  baseUrl: string,
  source: ReviewLinkSource = "link"
): string {
  return new URL(reviewLinkPath(code, source), baseUrl).toString()
}

const BOT =
  /(?<!cu)bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|skype|curl|wget|python-requests|headlesschrome|google-pagerenderer|mediapartners|linkexpanding/i

/**
 * Messaging apps and mail scanners open links to build previews; those are
 * not guests. No user agent counts as a bot. The user agent is read here
 * and never stored.
 */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT.test(userAgent)
}

const MAX_TARGET_LENGTH = 2048

/**
 * Hosts Google's review form is served from (`search.google.com/local/
 * writereview…`, `g.page/r/…/review`). The redirect follows nothing else,
 * whatever a stored payload says.
 */
const GOOGLE_REVIEW_HOSTS = ["google.com", "g.page", "goo.gl"]

function isGoogleReviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return GOOGLE_REVIEW_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  )
}

/**
 * The URL as the redirect will send it (parsed and re-serialised, so stray
 * control characters cannot reach a header), or null unless it is an
 * absolute https URL on one of Google's review hosts, with no credentials.
 */
export function normaliseReviewTarget(uri: unknown): string | null {
  if (typeof uri !== "string" || uri.length > MAX_TARGET_LENGTH) return null
  let url: URL
  try {
    url = new URL(uri.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) return null
  if (!isGoogleReviewHost(url.hostname)) return null
  return url.href.length > MAX_TARGET_LENGTH ? null : url.href
}

export function isAcceptableReviewTarget(uri: unknown): uri is string {
  return normaliseReviewTarget(uri) !== null
}

/**
 * Google's review form for a listing, from a stored Google read (the
 * profile or Business Information observation: `{ location: { metadata } }`).
 */
export function reviewUriFromObservedPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const location = (payload as { location?: unknown }).location
  if (!location || typeof location !== "object") return null
  const metadata = (location as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object") return null
  return normaliseReviewTarget(
    (metadata as { newReviewUri?: unknown }).newReviewUri
  )
}

/** The chart's periods, in days. */
export const REVIEW_LINK_PERIODS = [30, 90] as const
export type ReviewLinkPeriod = (typeof REVIEW_LINK_PERIODS)[number]

export function parseReviewLinkPeriod(value: unknown): ReviewLinkPeriod {
  return value === 90 || value === "90" ? 90 : 30
}

/** The instant's calendar date on the venue's wall clock, as YYYY-MM-DD. */
export function localDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant)
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

/** Calendar arithmetic on a YYYY-MM-DD key (no time zone involved). */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days))
  return shifted.toISOString().slice(0, 10)
}

/**
 * The last `days` calendar days at the venue, today included, oldest
 * first. Days are counted on the calendar, so a clock change neither
 * repeats nor skips one.
 */
export function reviewLinkWindow(
  now: Date,
  timeZone: string,
  days: number
): { startDate: string; endDate: string; dates: string[] } {
  const endDate = localDateKey(now, timeZone)
  const dates = Array.from({ length: days }, (_, index) =>
    addDays(endDate, index - (days - 1))
  )
  return { startDate: dates[0] ?? endDate, endDate, dates }
}

export type ReviewLinkDay = {
  date: string
  clicks: number
  qrClicks: number
  newReviews: number
}

export type ReviewLinkTotals = Omit<ReviewLinkDay, "date">

/** One entry per date, zero where nothing happened; rows outside the dates are dropped. */
export function fillReviewLinkSeries(
  dates: string[],
  rows: Array<{
    date: string
    clicks?: number
    qrClicks?: number
    newReviews?: number
  }>
): ReviewLinkDay[] {
  const byDate = new Map<string, ReviewLinkDay>(
    dates.map((date) => [date, { date, clicks: 0, qrClicks: 0, newReviews: 0 }])
  )
  for (const row of rows) {
    const day = byDate.get(row.date)
    if (!day) continue
    day.clicks += row.clicks ?? 0
    day.qrClicks += row.qrClicks ?? 0
    day.newReviews += row.newReviews ?? 0
  }
  return [...byDate.values()]
}

export function reviewLinkTotals(series: ReviewLinkDay[]): ReviewLinkTotals {
  return series.reduce<ReviewLinkTotals>(
    (sum, day) => ({
      clicks: sum.clicks + day.clicks,
      qrClicks: sum.qrClicks + day.qrClicks,
      newReviews: sum.newReviews + day.newReviews,
    }),
    { clicks: 0, qrClicks: 0, newReviews: 0 }
  )
}
