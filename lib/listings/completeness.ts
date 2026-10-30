// Source: packages/core/src/healthcheck/evaluate.ts and config/healthcheck.ts
// (check list, importance levels, thresholds). Adapted from OpenGMB (MIT,
// © 2026 Synectus Private Limited). Inputs are rewritten against what
// NabaPresence stores.
/**
 * Listing completeness: how complete and current a Google listing looks,
 * from deterministic checks over what NabaPresence already stores.
 *
 * Derived, never stored, and never from a Google call: like `listingHealth()`
 * it only reads earlier observations. A source that was never read, or was
 * read too long ago to trust, makes its checks "unknown", and unknown never
 * counts as a fail. Sync state (in sync, unpublished, conflict) stays in
 * `lib/listings/health.ts`. Pure and client-safe.
 */
import { nextBankHoliday } from "@/lib/listings/completeness-calendar"
import {
  descriptionProblems,
  similarity,
} from "@/lib/listings/completeness-text"
import type { StatusTone } from "@/lib/ui/status-tone"

export const COMPLETENESS_IMPORTANCE = [
  "necessary",
  "important",
  "nice",
] as const
export type CompletenessImportance = (typeof COMPLETENESS_IMPORTANCE)[number]

export const IMPORTANCE_WEIGHT: Record<CompletenessImportance, number> = {
  necessary: 3,
  important: 2,
  nice: 1,
}

export const COMPLETENESS_STATUSES = [
  "fail",
  "unknown",
  "pass",
  "not_applicable",
  "skipped",
] as const
export type CompletenessStatus = (typeof COMPLETENESS_STATUSES)[number]

export const COMPLETENESS_CHECK_IDS = [
  // necessary
  "primary_category",
  "regular_hours",
  "phone",
  "website",
  "verification",
  "description",
  // important
  "special_hours",
  "recent_post",
  "recent_photo",
  "cover_photo",
  "logo_photo",
  "unreplied_reviews",
  "booking_link",
  "services_or_menu",
  // nice
  "description_quality",
  "additional_categories",
  "attributes",
  "website_utm",
  "rating_trend",
] as const
export type CompletenessCheckId = (typeof COMPLETENESS_CHECK_IDS)[number]

/**
 * Thresholds. Each is our own rule of thumb for a well-kept pub listing, not
 * a limit Google states.
 */
export const COMPLETENESS_CONFIG = {
  /** A stored Google read older than this is too old to judge from. */
  snapshotMaxAgeDays: 30,
  /** Special hours are asked for when a bank holiday is this close. */
  specialHoursLookaheadDays: 45,
  recentPostDays: 30,
  recentPhotoDays: 90,
  /** A review without a reply for longer than this is overdue. */
  unrepliedReviewDays: 7,
  /** Google shows about the first 250 characters before "More". */
  minDescriptionChars: 250,
  maxUppercaseShare: 0.5,
  maxWordRepeats: 4,
  /** At or above this a description reads as a sibling venue's copy. */
  siblingDescriptionSimilarity: 0.9,
  ratingTrendWindowDays: 90,
  ratingTrendMinReviews: 5,
  /** Stars the average may fall by before the trend fails. */
  ratingTrendMaxDrop: 0.3,
} as const

/** A stored Google read and when it was made; null when never stored. */
export type Observed<T> = { value: T; observedAt: string } | null

export type CompletenessInput = {
  locationId: string
  linked: boolean
  /** `external_location.verified`; null when unknown or not linked. */
  verified: boolean | null
  profile: Observed<{
    primaryCategory: string | null
    additionalCategories: number
    phone: string | null
    website: string | null
    description: string | null
  }>
  /** Dates are YYYY-MM-DD, inclusive. */
  hours: Observed<{
    regularPeriods: number
    specialPeriods: readonly { start: string; end: string }[]
  }>
  /** Attributes and service items, from the stored business-information read. */
  details: Observed<{ attributes: number; serviceItems: number }>
  /** `eligible`: Google says the listing can have a food menu (null unknown). */
  menu: Observed<{ eligible: boolean | null; items: number }>
  posts: { lastPublishedAt: string | null; observedAt: string | null }
  photos: {
    newestAt: string | null
    cover: boolean
    logo: boolean
    observedAt: string | null
  }
  booking: { booking: number; other: number; observedAt: string | null }
  reviews: {
    /** The last successful review sync; null when never. */
    checkedAt: string | null
    /** Reviews without a reply for longer than `unrepliedReviewDays`. */
    overdueUnreplied: number
    /** Rated reviews in the last `ratingTrendWindowDays`. */
    recent: { count: number; average: number | null }
    /** Rated reviews in the window before that. */
    previous: { count: number; average: number | null }
  }
  /** Other listings the caller can see, with their stored description. */
  siblings: readonly { locationId: string; name: string; description: string }[]
}

export type CompletenessFix = { label: string; href: string }

export type CompletenessCheck = {
  id: CompletenessCheckId
  title: string
  importance: CompletenessImportance
  status: CompletenessStatus
  /** What was found, in plain words. */
  detail: string
  /** Where in the app to fix it; null when there is nothing to do. */
  fix: CompletenessFix | null
  skip?: { reason: string; skippedAt: string }
}

export type CompletenessSkip = {
  checkId: CompletenessCheckId
  reason: string
  skippedAt: string
}

export type CompletenessCounts = Record<CompletenessStatus, number>

export type ListingCompleteness = {
  locationId: string
  /** Weighted share of passing checks, 0–100; null when none is known. */
  score: number | null
  /** Importance weight of the failing checks, summed. */
  fixPoints: number
  counts: CompletenessCounts
  /** In `COMPLETENESS_CHECK_IDS` order. */
  checks: CompletenessCheck[]
}

const DAY_MS = 86_400_000

const DEFINITIONS: Record<
  CompletenessCheckId,
  { title: string; importance: CompletenessImportance }
> = {
  primary_category: { title: "Primary category", importance: "necessary" },
  regular_hours: { title: "Opening hours", importance: "necessary" },
  phone: { title: "Phone number", importance: "necessary" },
  website: { title: "Website", importance: "necessary" },
  verification: { title: "Verified by Google", importance: "necessary" },
  description: { title: "Business description", importance: "necessary" },
  special_hours: {
    title: "Hours for the next bank holiday",
    importance: "important",
  },
  recent_post: { title: "A post in the last 30 days", importance: "important" },
  recent_photo: {
    title: "A photo in the last 90 days",
    importance: "important",
  },
  cover_photo: { title: "Cover photo", importance: "important" },
  logo_photo: { title: "Logo", importance: "important" },
  unreplied_reviews: {
    title: "Reviews answered within a week",
    importance: "important",
  },
  booking_link: { title: "Booking link", importance: "important" },
  services_or_menu: { title: "Menu or services", importance: "important" },
  description_quality: { title: "Description reads well", importance: "nice" },
  additional_categories: {
    title: "Additional categories",
    importance: "nice",
  },
  attributes: { title: "Attributes", importance: "nice" },
  website_utm: {
    title: "Website link tagged for analytics",
    importance: "nice",
  },
  rating_trend: { title: "Rating holding steady", importance: "nice" },
}

export function completenessCheckTitle(id: CompletenessCheckId): string {
  return DEFINITIONS[id].title
}

export function completenessCheckImportance(
  id: CompletenessCheckId
): CompletenessImportance {
  return DEFINITIONS[id].importance
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function ageDays(at: string | null | undefined, now: Date): number | null {
  if (!at) return null
  const time = Date.parse(at)
  return Number.isFinite(time) ? (now.getTime() - time) / DAY_MS : null
}

/** Never read, or read too long ago to judge from. */
function staleness(
  observedAt: string | null | undefined,
  now: Date
): "missing" | "stale" | null {
  const age = ageDays(observedAt, now)
  if (age === null) return "missing"
  return age > COMPLETENESS_CONFIG.snapshotMaxAgeDays ? "stale" : null
}

function fresh<T>(observed: Observed<T>, now: Date): T | null {
  return observed && staleness(observed.observedAt, now) === null
    ? observed.value
    : null
}

function unknownDetail(
  subject: string,
  observedAt: string | null | undefined,
  now: Date
): string {
  const many = !subject.startsWith("The ")
  return staleness(observedAt, now) === "stale"
    ? `${subject} ${many ? "were" : "was"} last read from Google over ${COMPLETENESS_CONFIG.snapshotMaxAgeDays} days ago. Open ${many ? "them" : "it"} to check again.`
    : `${subject} ${many ? "haven’t" : "hasn’t"} been read from Google yet. Open ${many ? "them" : "it"} to check.`
}

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
})

function shortDate(date: string): string {
  return SHORT_DATE.format(new Date(`${date}T00:00:00Z`))
}

/** Every check for one listing, in `COMPLETENESS_CHECK_IDS` order. Never "skipped". */
export function evaluateCompleteness(
  input: CompletenessInput,
  now: Date
): CompletenessCheck[] {
  const cfg = COMPLETENESS_CONFIG
  const area = (segment: string) => `/listings/${input.locationId}/${segment}`
  const inbox = `/inbox?locationId=${encodeURIComponent(input.locationId)}`
  const results = new Map<
    CompletenessCheckId,
    { status: CompletenessStatus; detail: string; fix: CompletenessFix | null }
  >()
  const set = (
    id: CompletenessCheckId,
    status: CompletenessStatus,
    detail: string,
    fix: CompletenessFix | null
  ) => results.set(id, { status, detail, fix })

  if (!input.linked) {
    return COMPLETENESS_CHECK_IDS.map((id) => ({
      id,
      ...DEFINITIONS[id],
      status: "unknown" as const,
      detail: "Not linked to Google yet.",
      fix: null,
    }))
  }

  // Profile fields: one stored read feeds seven checks.
  const profile = fresh(input.profile, now)
  const profileFix = (label: string) => ({ label, href: area("profile") })
  const profileUnknown = unknownDetail(
    "The profile",
    input.profile?.observedAt,
    now
  )
  const fromProfile = (
    id: CompletenessCheckId,
    label: string,
    judge: (value: NonNullable<typeof profile>) => {
      status: CompletenessStatus
      detail: string
    }
  ) => {
    if (!profile) return set(id, "unknown", profileUnknown, profileFix(label))
    const result = judge(profile)
    set(id, result.status, result.detail, profileFix(label))
  }

  fromProfile("primary_category", "Set category", (value) =>
    value.primaryCategory?.trim()
      ? { status: "pass", detail: value.primaryCategory.trim() }
      : { status: "fail", detail: "No primary category on Google." }
  )
  fromProfile("phone", "Add phone", (value) =>
    value.phone?.trim()
      ? { status: "pass", detail: value.phone.trim() }
      : { status: "fail", detail: "No phone number on Google." }
  )
  fromProfile("website", "Add website", (value) =>
    value.website?.trim()
      ? { status: "pass", detail: value.website.trim() }
      : { status: "fail", detail: "No website on Google." }
  )
  fromProfile("description", "Write description", (value) => {
    const text = value.description?.trim() ?? ""
    return text
      ? { status: "pass", detail: plural([...text].length, "character") }
      : { status: "fail", detail: "No business description on Google." }
  })
  fromProfile("description_quality", "Edit description", (value) => {
    const text = value.description?.trim() ?? ""
    if (!text)
      return {
        status: "not_applicable",
        detail: "Add a description first.",
      }
    const problems = descriptionProblems(text, {
      minChars: cfg.minDescriptionChars,
      maxUppercaseShare: cfg.maxUppercaseShare,
      maxWordRepeats: cfg.maxWordRepeats,
    })
    const twin = input.siblings.find(
      (sibling) =>
        sibling.locationId !== input.locationId &&
        similarity(text, sibling.description) >=
          cfg.siblingDescriptionSimilarity
    )
    if (twin) problems.push(`reads the same as ${twin.name}’s`)
    return problems.length
      ? {
          status: "fail",
          detail: `The description ${problems.join("; ")}.`,
        }
      : {
          status: "pass",
          detail: "Long enough, written for people, and its own.",
        }
  })
  fromProfile("additional_categories", "Add categories", (value) =>
    value.additionalCategories > 0
      ? {
          status: "pass",
          detail: plural(
            value.additionalCategories,
            "additional category",
            "additional categories"
          ),
        }
      : {
          status: "fail",
          detail: "Only the primary category. Add the others that fit.",
        }
  )
  fromProfile("website_utm", "Tag website link", (value) => {
    const website = value.website?.trim()
    if (!website)
      return { status: "not_applicable", detail: "No website to tag." }
    let tagged = false
    try {
      tagged = [...new URL(website).searchParams.keys()].some((key) =>
        key.startsWith("utm_")
      )
    } catch {
      // An unparseable link can't carry tags.
    }
    return tagged
      ? { status: "pass", detail: "The website link carries utm_ tags." }
      : {
          status: "fail",
          detail:
            "The website link has no utm_ tags, so visits from Google can’t be told apart in analytics.",
        }
  })

  // Hours.
  const hours = fresh(input.hours, now)
  const hoursFix = (label: string) => ({ label, href: area("hours") })
  if (!hours)
    set(
      "regular_hours",
      "unknown",
      unknownDetail("Opening hours", input.hours?.observedAt, now),
      hoursFix("Add hours")
    )
  else if (hours.regularPeriods > 0)
    set(
      "regular_hours",
      "pass",
      plural(hours.regularPeriods, "opening period"),
      hoursFix("Add hours")
    )
  else
    set(
      "regular_hours",
      "fail",
      "Google shows no opening hours.",
      hoursFix("Add hours")
    )

  const holiday = nextBankHoliday(now, cfg.specialHoursLookaheadDays)
  if (!holiday)
    set(
      "special_hours",
      "not_applicable",
      `No bank holiday in the next ${cfg.specialHoursLookaheadDays} days.`,
      null
    )
  else if (!hours)
    set(
      "special_hours",
      "unknown",
      unknownDetail("Opening hours", input.hours?.observedAt, now),
      hoursFix("Add special hours")
    )
  else if (
    hours.specialPeriods.some(
      (period) => period.start <= holiday.date && holiday.date <= period.end
    )
  )
    set(
      "special_hours",
      "pass",
      `Special hours set for ${holiday.name} (${shortDate(holiday.date)}).`,
      hoursFix("Add special hours")
    )
  else
    set(
      "special_hours",
      "fail",
      `No special hours for ${holiday.name} (${shortDate(holiday.date)}).`,
      hoursFix("Add special hours")
    )

  // Verification.
  const verifyFix = { label: "Verify listing", href: area("verification") }
  if (input.verified === true)
    set("verification", "pass", "Google has verified this listing.", verifyFix)
  else if (input.verified === false)
    set(
      "verification",
      "fail",
      "Google hasn’t verified this listing, so some changes won’t show.",
      verifyFix
    )
  else
    set(
      "verification",
      "unknown",
      "Verification hasn’t been read from Google yet.",
      verifyFix
    )

  // Posts and photos: what we hold that is recent passes even when the
  // list itself was read long ago.
  const postFix = { label: "Write a post", href: area("posts") }
  const postAge = ageDays(input.posts.lastPublishedAt, now)
  if (postAge !== null && postAge <= cfg.recentPostDays)
    set(
      "recent_post",
      "pass",
      postAge < 1
        ? "Last post today."
        : `Last post ${plural(Math.floor(postAge), "day")} ago.`,
      postFix
    )
  else if (staleness(input.posts.observedAt, now))
    set(
      "recent_post",
      "unknown",
      unknownDetail("Posts", input.posts.observedAt, now),
      postFix
    )
  else
    set(
      "recent_post",
      "fail",
      postAge === null
        ? "No posts on Google."
        : `Last post ${plural(Math.floor(postAge), "day")} ago.`,
      postFix
    )

  const photoFix = (label: string) => ({ label, href: area("photos") })
  const photosUnknown = staleness(input.photos.observedAt, now)
  const photoAge = ageDays(input.photos.newestAt, now)
  if (photoAge !== null && photoAge <= cfg.recentPhotoDays)
    set(
      "recent_photo",
      "pass",
      photoAge < 1
        ? "Newest photo added today."
        : `Newest photo added ${plural(Math.floor(photoAge), "day")} ago.`,
      photoFix("Add a photo")
    )
  else if (photosUnknown)
    set(
      "recent_photo",
      "unknown",
      unknownDetail("Photos", input.photos.observedAt, now),
      photoFix("Add a photo")
    )
  else
    set(
      "recent_photo",
      "fail",
      photoAge === null
        ? "No owner photos on Google."
        : `Newest photo added ${plural(Math.floor(photoAge), "day")} ago.`,
      photoFix("Add a photo")
    )
  const photoKind = (
    id: CompletenessCheckId,
    present: boolean,
    noun: string,
    label: string
  ) => {
    if (present) set(id, "pass", `${noun} set.`, photoFix(label))
    else if (photosUnknown)
      set(
        id,
        "unknown",
        unknownDetail("Photos", input.photos.observedAt, now),
        photoFix(label)
      )
    else set(id, "fail", `No ${noun.toLowerCase()} on Google.`, photoFix(label))
  }
  photoKind(
    "cover_photo",
    input.photos.cover,
    "Cover photo",
    "Add a cover photo"
  )
  photoKind("logo_photo", input.photos.logo, "Logo", "Add a logo")

  // Reviews.
  const reviewsUnknown = staleness(input.reviews.checkedAt, now)
  const reviewsUnknownDetail =
    reviewsUnknown === "stale"
      ? `Reviews haven’t synced from Google in over ${cfg.snapshotMaxAgeDays} days.`
      : "Reviews haven’t synced from Google yet."
  const replyFix = { label: "Reply to reviews", href: inbox }
  if (reviewsUnknown)
    set("unreplied_reviews", "unknown", reviewsUnknownDetail, replyFix)
  else if (input.reviews.overdueUnreplied === 0)
    set(
      "unreplied_reviews",
      "pass",
      `No review has waited more than ${cfg.unrepliedReviewDays} days for a reply.`,
      replyFix
    )
  else
    set(
      "unreplied_reviews",
      "fail",
      `${plural(input.reviews.overdueUnreplied, "review")} older than ${cfg.unrepliedReviewDays} days ${input.reviews.overdueUnreplied === 1 ? "has" : "have"} no reply.`,
      replyFix
    )

  const trendFix = { label: "Read reviews", href: inbox }
  const { recent, previous } = input.reviews
  if (reviewsUnknown)
    set("rating_trend", "unknown", reviewsUnknownDetail, trendFix)
  else if (
    recent.average === null ||
    previous.average === null ||
    recent.count < cfg.ratingTrendMinReviews ||
    previous.count < cfg.ratingTrendMinReviews
  )
    set(
      "rating_trend",
      "not_applicable",
      `Too few rated reviews to compare: at least ${cfg.ratingTrendMinReviews} are needed in each ${cfg.ratingTrendWindowDays}-day window.`,
      null
    )
  else {
    const change = `${previous.average.toFixed(1)} to ${recent.average.toFixed(1)} stars over the last ${cfg.ratingTrendWindowDays} days`
    if (recent.average < previous.average - cfg.ratingTrendMaxDrop)
      set("rating_trend", "fail", `The average fell from ${change}.`, trendFix)
    else
      set("rating_trend", "pass", `The average went from ${change}.`, trendFix)
  }

  // Booking.
  const bookingFix = { label: "Add a booking link", href: area("booking") }
  if (input.booking.booking > 0)
    set(
      "booking_link",
      "pass",
      plural(input.booking.booking, "booking link"),
      bookingFix
    )
  else if (staleness(input.booking.observedAt, now))
    set(
      "booking_link",
      "unknown",
      unknownDetail("Booking links", input.booking.observedAt, now),
      bookingFix
    )
  else
    set(
      "booking_link",
      "fail",
      input.booking.other > 0
        ? "Only ordering links on Google, no way to book a table."
        : "No booking link on Google.",
      bookingFix
    )

  // Menu or services: a food venue needs a menu; anyone else, services.
  const menu = fresh(input.menu, now)
  const details = fresh(input.details, now)
  if (menu && menu.items > 0)
    set(
      "services_or_menu",
      "pass",
      `${plural(menu.items, "menu item")} on Google.`,
      null
    )
  else if (details && details.serviceItems > 0)
    set(
      "services_or_menu",
      "pass",
      `${plural(details.serviceItems, "service")} on Google.`,
      null
    )
  else if (menu?.eligible === true)
    set("services_or_menu", "fail", "No food menu on Google.", {
      label: "Add menu",
      href: area("menu"),
    })
  else if (menu?.eligible === false && details)
    set("services_or_menu", "fail", "No services listed on Google.", {
      label: "Add services",
      href: area("profile"),
    })
  else
    set(
      "services_or_menu",
      "unknown",
      menu
        ? unknownDetail("The profile", input.details?.observedAt, now)
        : unknownDetail("The menu", input.menu?.observedAt, now),
      menu
        ? { label: "Open profile", href: area("profile") }
        : { label: "Open menu", href: area("menu") }
    )

  // Attributes come only from the business-information read.
  const attributesFix = profileFix("Fill in attributes")
  if (!details)
    set(
      "attributes",
      "unknown",
      unknownDetail("Attributes", input.details?.observedAt, now),
      attributesFix
    )
  else if (details.attributes > 0)
    set(
      "attributes",
      "pass",
      plural(details.attributes, "attribute"),
      attributesFix
    )
  else
    set(
      "attributes",
      "fail",
      "No attributes set, such as dogs welcome, outdoor seating or step-free access.",
      attributesFix
    )

  return COMPLETENESS_CHECK_IDS.map((id) => {
    const result = results.get(id)
    if (!result) throw new Error(`Completeness check not evaluated: ${id}`)
    const keepsFix = result.status === "fail" || result.status === "unknown"
    return {
      id,
      ...DEFINITIONS[id],
      status: result.status,
      detail: result.detail,
      fix: keepsFix ? result.fix : null,
    }
  })
}

/** A skipped check keeps what was found, and stops counting either way. */
export function applyCompletenessSkips(
  checks: CompletenessCheck[],
  skips: readonly CompletenessSkip[]
): CompletenessCheck[] {
  if (skips.length === 0) return checks
  const byId = new Map(skips.map((skip) => [skip.checkId, skip]))
  return checks.map((check) => {
    const skip = byId.get(check.id)
    return skip
      ? {
          ...check,
          status: "skipped",
          fix: null,
          skip: { reason: skip.reason, skippedAt: skip.skippedAt },
        }
      : check
  })
}

export function scoreCompleteness(checks: readonly CompletenessCheck[]): {
  score: number | null
  fixPoints: number
  counts: CompletenessCounts
} {
  const counts = Object.fromEntries(
    COMPLETENESS_STATUSES.map((status) => [status, 0])
  ) as CompletenessCounts
  let passed = 0
  let failed = 0
  for (const check of checks) {
    counts[check.status] += 1
    const weight = IMPORTANCE_WEIGHT[check.importance]
    if (check.status === "pass") passed += weight
    if (check.status === "fail") failed += weight
  }
  const known = passed + failed
  return {
    score: known === 0 ? null : Math.round((100 * passed) / known),
    fixPoints: failed,
    counts,
  }
}

export function listingCompleteness(
  input: CompletenessInput,
  skips: readonly CompletenessSkip[],
  now: Date
): ListingCompleteness {
  const checks = applyCompletenessSkips(evaluateCompleteness(input, now), skips)
  return { locationId: input.locationId, ...scoreCompleteness(checks), checks }
}

const IMPORTANCE_RANK: Record<CompletenessImportance, number> = {
  necessary: 0,
  important: 1,
  nice: 2,
}

/** Failing checks, most important first, in check order within a level. */
export function failingChecks(
  completeness: Pick<ListingCompleteness, "checks">
): CompletenessCheck[] {
  const order = (check: CompletenessCheck) =>
    COMPLETENESS_CHECK_IDS.indexOf(check.id)
  return completeness.checks
    .filter((check) => check.status === "fail")
    .sort(
      (left, right) =>
        IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance] ||
        order(left) - order(right)
    )
}

/** "Most to fix" first: the heaviest failing weight, then the lowest score; unscored last. */
export function compareMostToFix(
  left: Pick<ListingCompleteness, "fixPoints" | "score">,
  right: Pick<ListingCompleteness, "fixPoints" | "score">
): number {
  if (left.fixPoints !== right.fixPoints)
    return right.fixPoints - left.fixPoints
  if (left.score === null || right.score === null)
    return left.score === null ? (right.score === null ? 0 : 1) : -1
  return left.score - right.score
}

/** The score as the board shows it. */
export function completenessLabel(score: number | null): string {
  return score === null ? "Not known yet" : `${score}%`
}

export function completenessTone(score: number | null): StatusTone {
  if (score === null) return "neutral"
  if (score >= 90) return "healthy"
  if (score >= 60) return "attention"
  return "at-risk"
}

/** One line for a listing: how much is left to fix. */
export function completenessSummary(
  completeness: Pick<ListingCompleteness, "counts" | "score">
): string {
  const { fail, unknown } = completeness.counts
  if (completeness.score === null)
    return unknown > 0
      ? "Nothing has been read from Google recently enough to judge."
      : "No checks apply."
  const parts = [
    fail === 0 ? "Nothing to fix" : `${plural(fail, "thing")} to fix`,
  ]
  if (unknown > 0) parts.push(`${unknown} not known yet`)
  return parts.join(" · ")
}
