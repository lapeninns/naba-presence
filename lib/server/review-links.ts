import "server-only"

import type { TransactionSql } from "postgres"

import {
  checkReviewLinkCaption,
  normaliseReviewLinkCaption,
} from "@/lib/domain/review-link-caption"
import {
  reviewLinkQueryKeys,
  type ReviewLink,
  type ReviewLinkAction,
  type ReviewLinkState,
  type ReviewLinkStats,
} from "@/lib/domain/review-link-contract"
import {
  fillReviewLinkSeries,
  isReviewLinkCode,
  generateReviewLinkCode,
  normaliseReviewTarget,
  reviewLinkTotals,
  reviewLinkUrl,
  reviewLinkWindow,
  reviewUriFromObservedPayload,
  type ReviewLinkPeriod,
  type ReviewLinkSource,
} from "@/lib/domain/review-link"
import {
  abuseKeyHash,
  clientIpFromRequest,
  type AbuseDecision,
} from "@/lib/server/abuse-limits"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  actionAllowed,
  grantsFor,
  requireLocationAccess,
  type LocationNotFound,
} from "@/lib/server/permissions"
import type { PrefetchEntry } from "@/lib/server/prefetch"
import { readObservedGooglePayload } from "@/lib/server/resource-observations"
import type { Session } from "@/lib/server/session"

/**
 * Review links (migration 0310): one short link per location to Google's
 * review form, its public resolution and its click counts. The pure rules
 * (codes, targets, captions, days) are in lib/domain/review-link*.ts.
 *
 * Everything here that a signed-in person reaches is DB-only: the target is
 * Google's `metadata.newReviewUri` from the listing's last stored read
 * (profile or Business Information). Reading Google again is the existing
 * Business Information refresh, which the area page offers.
 */

export const REVIEW_LINK_LOCATION_NOT_FOUND: LocationNotFound = {
  code: "location_not_found",
  message: "The requested location was not found.",
}

/** The app's origin for absolute links: NEXTAUTH_URL, else the request's. */
export function reviewLinkBaseUrl(request?: Request): string {
  return (
    getServerEnv().NEXTAUTH_URL ??
    (request ? new URL(request.url).origin : "http://localhost:3000")
  )
}

/**
 * The same for a server component, from its request headers, so the first
 * paint and the API agree when NEXTAUTH_URL is unset (local development).
 */
export function reviewLinkBaseUrlFromHeaders(
  headers: Pick<Headers, "get">
): string {
  const configured = getServerEnv().NEXTAUTH_URL
  if (configured) return configured
  const host = headers.get("x-forwarded-host") ?? headers.get("host")
  const proto = headers.get("x-forwarded-proto") ?? "http"
  return host ? `${proto}://${host}` : reviewLinkBaseUrl()
}

type ReviewLinkRow = {
  id: string
  code: string
  targetUri: string
  caption: string | null
  createdAt: Date
  rotatedAt: Date | null
  disabledAt: Date | null
}

function reviewLinkColumns(sql: TransactionSql) {
  return sql`
    l.id::text as id,
    l.code,
    l.target_uri as "targetUri",
    l.caption,
    l.created_at as "createdAt",
    l.rotated_at as "rotatedAt",
    l.disabled_at as "disabledAt"
  `
}

function toReviewLink(row: ReviewLinkRow, baseUrl: string): ReviewLink {
  return {
    id: row.id,
    code: row.code,
    url: reviewLinkUrl(row.code, baseUrl),
    qrUrl: reviewLinkUrl(row.code, baseUrl, "qr"),
    caption: row.caption,
    targetUri: row.targetUri,
    status: row.disabledAt ? "off" : "live",
    createdAt: row.createdAt.toISOString(),
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
  }
}

/**
 * The location under RLS, or the 404. An owner's or admin's grant covers
 * any id (grantsFor), so this is what keeps another tenant's location id
 * indistinguishable from one that exists nowhere.
 */
async function requireLocationRow(
  sql: TransactionSql,
  locationId: string
): Promise<{ timeZone: string }> {
  const [row] = await sql<{ timeZone: string }[]>`
    select timezone as "timeZone" from location where id = ${locationId}
  `
  if (!row) {
    throw new ApiError(
      404,
      REVIEW_LINK_LOCATION_NOT_FOUND.code!,
      REVIEW_LINK_LOCATION_NOT_FOUND.message!
    )
  }
  return row
}

/**
 * Google's review form from the listing's last stored read, or null. The
 * profile read is tried first, then Business Information; both ask Google
 * for `metadata`.
 */
export async function storedGoogleReviewTarget(
  sql: TransactionSql,
  organisationId: string,
  locationId: string
): Promise<string | null> {
  for (const resource of ["profile", "businessInformation"] as const) {
    const observed = await readObservedGooglePayload(sql, {
      organisationId,
      locationId,
      resource,
    })
    const target = reviewUriFromObservedPayload(observed?.payload)
    if (target) return target
  }
  return null
}

async function selectLink(
  sql: TransactionSql,
  locationId: string,
  options: { forUpdate?: boolean } = {}
): Promise<ReviewLinkRow | null> {
  const [row] = await sql<ReviewLinkRow[]>`
    select ${reviewLinkColumns(sql)}
    from review_link l
    where l.location_id = ${locationId}
    ${options.forUpdate ? sql`for update` : sql``}
  `
  return row ?? null
}

/**
 * The area page's state. Read only, no Google call. The caller has checked
 * that the location is visible (requireLocationAccess).
 */
export async function readReviewLinkState(
  sql: TransactionSql,
  session: Session,
  locationId: string,
  baseUrl: string
): Promise<ReviewLinkState> {
  await requireLocationRow(sql, locationId)
  const row = await selectLink(sql, locationId)
  const googleTarget = await storedGoogleReviewTarget(
    sql,
    session.organisationId,
    locationId
  )
  const grants = await grantsFor(sql, session, [locationId])
  const grant = grants.get(locationId)
  return {
    link: row ? toReviewLink(row, baseUrl) : null,
    googleTarget,
    targetChanged: Boolean(
      row && googleTarget && row.targetUri !== googleTarget
    ),
    canManage: grant ? actionAllowed(session.role, grant, "edit") : false,
  }
}

/** readReviewLinkState in its own tenant transaction (prefetch). */
export async function loadReviewLinkState(
  session: Session,
  locationId: string,
  baseUrl: string = reviewLinkBaseUrl()
): Promise<ReviewLinkState> {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(
      sql,
      session,
      locationId,
      REVIEW_LINK_LOCATION_NOT_FOUND
    )
    return readReviewLinkState(sql, session, locationId, baseUrl)
  })
}

/** /listings/{id}/review-link: the state the page reads first. */
export function reviewLinkTabPrefetch(
  locationId: string,
  baseUrl?: string
): (session: Session) => PrefetchEntry[] {
  return (session) => [
    {
      queryKey: reviewLinkQueryKeys.state(locationId),
      load: () => loadReviewLinkState(session, locationId, baseUrl),
    },
  ]
}

function targetMissing(): ApiError {
  return new ApiError(
    409,
    "review_link_target_missing",
    "Google hasn’t given this listing a review link yet. Refresh the listing’s details from Google, then try again."
  )
}

/** The saved caption: normalised, checked, null for the default. */
function acceptedCaption(input: string | null | undefined): string | null {
  const caption = normaliseReviewLinkCaption(input)
  if (caption === null) return null
  const check = checkReviewLinkCaption(caption)
  if (!check.ok) {
    throw new ApiError(
      422,
      "review_link_caption_rejected",
      check.problems[0]!.message,
      { details: { ruleIds: check.problems.map((problem) => problem.ruleId) } }
    )
  }
  return caption
}

/** Postgres unique_violation, as postgres.js reports it. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}

/** Codes are global: a clash (about 1 in 10^14) is retried with a new one. */
const CODE_ATTEMPTS = 5

async function withFreshCode<T>(
  sql: TransactionSql,
  write: (sql: TransactionSql, code: string) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return (await sql.savepoint((sp) =>
        write(sp, generateReviewLinkCode())
      )) as T
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= CODE_ATTEMPTS) throw error
    }
  }
}

type MutationInput = {
  session: Session
  locationId: string
  requestId: string
  baseUrl: string
}

/**
 * Creates the location's link, pointing at Google's review form. Creating
 * one that exists returns it unchanged. The caller has checked the "edit"
 * action at the location.
 */
export async function createReviewLink(
  sql: TransactionSql,
  input: MutationInput & { caption?: string | null }
): Promise<{ link: ReviewLink; created: boolean }> {
  const { session, locationId } = input
  await requireLocationRow(sql, locationId)
  const existing = await selectLink(sql, locationId)
  if (existing) {
    return { link: toReviewLink(existing, input.baseUrl), created: false }
  }
  const target = await storedGoogleReviewTarget(
    sql,
    session.organisationId,
    locationId
  )
  if (!target) throw targetMissing()
  const caption = acceptedCaption(input.caption)
  const row = await withFreshCode(sql, async (sp, code) => {
    const [inserted] = await sp<ReviewLinkRow[]>`
      with inserted as (
        insert into review_link (
          organisation_id, location_id, code, target_uri, caption, created_by
        )
        select ${session.organisationId}, loc.id, ${code}, ${target},
          ${caption}, ${session.userId}
        from location loc
        where loc.id = ${locationId}
        on conflict (location_id) do nothing
        returning *
      )
      select ${reviewLinkColumns(sp)} from inserted l
    `
    return inserted ?? null
  })
  if (!row) {
    // Someone else created it a moment ago.
    const raced = await selectLink(sql, locationId)
    if (!raced) throw targetMissing()
    return { link: toReviewLink(raced, input.baseUrl), created: false }
  }
  await writeAudit(sql, {
    organisationId: session.organisationId,
    actorUserId: session.userId,
    action: "review_link.created",
    subjectType: "review_link",
    subjectId: row.id,
    requestId: input.requestId,
    metadata: { locationId, captioned: caption !== null },
  })
  return { link: toReviewLink(row, input.baseUrl), created: true }
}

/**
 * Rotate, switch off, switch back on, follow Google's current review form,
 * or change the caption. Every change also follows Google's current form
 * when the stored read has one. The caller has checked the "edit" action.
 */
export async function updateReviewLink(
  sql: TransactionSql,
  input: MutationInput & { action: ReviewLinkAction }
): Promise<ReviewLink> {
  const { session, locationId, action } = input
  await requireLocationRow(sql, locationId)
  const current = await selectLink(sql, locationId, { forUpdate: true })
  if (!current) {
    throw new ApiError(
      404,
      "review_link_not_found",
      "This listing has no review link yet. Create one first."
    )
  }
  const googleTarget = await storedGoogleReviewTarget(
    sql,
    session.organisationId,
    locationId
  )
  if (action.action === "sync_target" && !googleTarget) throw targetMissing()
  const target = normaliseReviewTarget(googleTarget) ?? current.targetUri

  let row: ReviewLinkRow | undefined
  switch (action.action) {
    case "rotate":
      row = await withFreshCode(sql, async (sp, code) => {
        const [updated] = await sp<ReviewLinkRow[]>`
          update review_link l
          set code = ${code}, target_uri = ${target},
            rotated_at = now(), updated_at = now()
          where l.id = ${current.id}
          returning ${reviewLinkColumns(sp)}
        `
        return updated
      })
      break
    case "disable":
      row = (
        await sql<ReviewLinkRow[]>`
          update review_link l
          set disabled_at = coalesce(l.disabled_at, now()),
            disabled_by = case when l.disabled_at is null then ${session.userId}::uuid else l.disabled_by end,
            updated_at = now()
          where l.id = ${current.id}
          returning ${reviewLinkColumns(sql)}
        `
      )[0]
      break
    case "enable":
      row = (
        await sql<ReviewLinkRow[]>`
          update review_link l
          set disabled_at = null, disabled_by = null, target_uri = ${target},
            updated_at = now()
          where l.id = ${current.id}
          returning ${reviewLinkColumns(sql)}
        `
      )[0]
      break
    case "sync_target":
      row = (
        await sql<ReviewLinkRow[]>`
          update review_link l
          set target_uri = ${target}, updated_at = now()
          where l.id = ${current.id}
          returning ${reviewLinkColumns(sql)}
        `
      )[0]
      break
    case "caption": {
      const caption = acceptedCaption(action.caption)
      row = (
        await sql<ReviewLinkRow[]>`
          update review_link l
          set caption = ${caption}, target_uri = ${target}, updated_at = now()
          where l.id = ${current.id}
          returning ${reviewLinkColumns(sql)}
        `
      )[0]
      break
    }
  }
  if (!row) throw new Error("review_link update returned no row")
  await writeAudit(sql, {
    organisationId: session.organisationId,
    actorUserId: session.userId,
    action: `review_link.${action.action === "sync_target" ? "target_synced" : action.action === "caption" ? "caption_changed" : `${action.action}d`}`,
    subjectType: "review_link",
    subjectId: row.id,
    requestId: input.requestId,
    metadata: {
      locationId,
      targetChanged: row.targetUri !== current.targetUri,
      ...(action.action === "caption"
        ? { captioned: row.caption !== null }
        : {}),
    },
  })
  return toReviewLink(row, input.baseUrl)
}

/**
 * Clicks and new reviews per calendar day at the venue, over the last
 * `days` days, today included. A rotated link's clicks stay with it. The
 * caller has checked that the location is visible.
 */
export async function readReviewLinkStats(
  sql: TransactionSql,
  locationId: string,
  days: ReviewLinkPeriod,
  now: Date = new Date()
): Promise<ReviewLinkStats> {
  const { timeZone } = await requireLocationRow(sql, locationId)
  const window = reviewLinkWindow(now, timeZone, days)
  // The window's first instant: local midnight of its first day.
  const from = sql`((${window.startDate}::date)::timestamp at time zone ${timeZone})`
  const clicks = await sql<
    { date: string; clicks: number; qrClicks: number }[]
  >`
      select to_char(c.clicked_at at time zone ${timeZone}, 'YYYY-MM-DD') as date,
        count(*)::integer as clicks,
        count(*) filter (where c.source = 'qr')::integer as "qrClicks"
      from review_link_click c
      join review_link l on l.id = c.link_id
      where l.location_id = ${locationId}
        and c.clicked_at >= ${from}
      group by 1
  `
  const reviews = await sql<{ date: string; newReviews: number }[]>`
      select to_char(r.create_time at time zone ${timeZone}, 'YYYY-MM-DD') as date,
        count(*)::integer as "newReviews"
      from review r
      where r.location_id = ${locationId}
        and r.provider_deleted_at is null
        and r.create_time >= ${from}
      group by 1
  `
  const series = fillReviewLinkSeries(window.dates, [...clicks, ...reviews])
  return {
    days,
    timeZone,
    startDate: window.startDate,
    endDate: window.endDate,
    series,
    totals: reviewLinkTotals(series),
  }
}

// ---------------------------------------------------------------------------
// The public route (/r/<code>): no session.
// ---------------------------------------------------------------------------

/** A live link, as far as the redirect needs to know. */
export type ResolvedReviewLink = {
  linkId: string
  organisationId: string
  targetUri: string
}

/**
 * Resolves a code to its live link, or null for anything else (unknown,
 * rotated away, switched off, or not a code at all). Cross-tenant by
 * design, through the SECURITY DEFINER lookup_review_link(). The stored
 * target is checked again, so the redirect only ever follows Google's
 * review hosts.
 */
export async function resolveReviewLink(
  code: unknown
): Promise<ResolvedReviewLink | null> {
  if (!isReviewLinkCode(code)) return null
  const [row] = await getDatabase()<ResolvedReviewLink[]>`
    select link_id::text as "linkId",
      organisation_id::text as "organisationId",
      target_uri as "targetUri"
    from lookup_review_link(${code})
  `
  if (!row) return null
  const targetUri = normaliseReviewTarget(row.targetUri)
  return targetUri ? { ...row, targetUri } : null
}

/**
 * Counts one open. Best effort: a failure is logged and swallowed, never
 * shown to the guest, whose redirect goes ahead.
 */
export async function recordReviewLinkClick(
  link: ResolvedReviewLink,
  source: ReviewLinkSource
): Promise<void> {
  try {
    await withTenant(link.organisationId, (sql) =>
      sql`
        insert into review_link_click (organisation_id, link_id, source)
        values (${link.organisationId}, ${link.linkId}, ${source})
      `.then(() => undefined)
    )
  } catch (error) {
    log.warn("review_link.click_not_recorded", {
      organisationId: link.organisationId,
      linkId: link.linkId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Counted opens per client IP. Over it, a live code still redirects but
 * isn't counted (lots of guests share a pub's Wi-Fi address), and an
 * unknown code gets a "try again" page, so walking codes stays slow.
 */
export const REVIEW_LINK_IP_LIMIT = { limit: 120, windowSeconds: 15 * 60 }

// INTEGRATION(S2): this is ABUSE_POLICIES' report_share shape for a new
// scope. Add `review_link: { code: "auth_rate_limited", ip: REVIEW_LINK_IP_LIMIT }`
// to ABUSE_POLICIES in lib/server/abuse-limits.ts and replace this body with
// `checkAbuseBudget("review_link", { ip: clientIpFromRequest(request) })`.
// The bucket name (`review_link_ip`) is the same either way.
/**
 * Counts one open against the client IP's budget (abuse_rate_bucket via
 * take_abuse_budget, migration 0085), with the same rules as
 * checkAbuseBudget: off when ABUSE_LIMITS_ENABLED is false, nothing to
 * count without a trusted client IP, and fails closed on a database error.
 */
export async function takeReviewLinkBudget(
  request: Request
): Promise<AbuseDecision> {
  const env = getServerEnv()
  if (!env.ABUSE_LIMITS_ENABLED) return { allowed: true, retryAfterSeconds: 0 }
  const ip = clientIpFromRequest(request)
  if (!ip) return { allowed: true, retryAfterSeconds: 0 }
  const [row] = await getDatabase()<
    { allowed: boolean; retryAfterSeconds: number }[]
  >`
    select allowed, retry_after_seconds as "retryAfterSeconds"
    from take_abuse_budget(
      ${"review_link_ip"},
      ${abuseKeyHash("ip", ip, env.NEXTAUTH_SECRET)},
      ${REVIEW_LINK_IP_LIMIT.limit},
      ${REVIEW_LINK_IP_LIMIT.windowSeconds}
    )
  `
  if (row && !row.allowed) {
    log.warn("abuse.limit_exceeded", {
      scope: "review_link",
      retryAfterSeconds: row.retryAfterSeconds,
    })
    return { allowed: false, retryAfterSeconds: row.retryAfterSeconds }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}
