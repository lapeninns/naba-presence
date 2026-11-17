import "server-only"

import type { TransactionSql } from "postgres"

import type { VenueContext } from "@/lib/domain/reply-policy"
import { loadBannedPhrases } from "@/lib/server/content-checks"

/**
 * What a reply to one review may draw on, read in the caller's tenant
 * transaction and keyed by the review's own location, so one venue's facts
 * can never reach another venue's reply:
 *
 *   venue                 the location's name, its town, and what its stored
 *                         Google profile and menu say about it;
 *   otherLocationNames    the business's other venues, which a reply must
 *                         not name (the `wrong_location` check);
 *   bannedPhrases         the organisation's banned phrases;
 *   recentReplies         replies recently published for the same client,
 *                         so a new one is not a copy and does not open alike.
 *
 * Nothing here is typed in by the person asking for the reply. A fact that
 * was never read from Google is simply absent.
 */
export type ReplyContext = {
  venue: VenueContext
  otherLocationNames: string[]
  bannedPhrases: string[]
  recentReplies: string[]
}

const MAX_DESCRIPTION_CHARS = 750
const MAX_MENU_ITEMS = 60

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.replace(/\s+/gu, " ").trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Dish names from a stored food-menus payload, whatever its nesting. */
export function menuItemNames(payload: unknown): string[] {
  const names = new Set<string>()
  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || names.size >= MAX_MENU_ITEMS) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }
    const object = record(node)
    if (!object) return
    if (Array.isArray(object.items)) {
      for (const item of object.items) {
        const entry = record(item)
        if (!entry) continue
        const label = Array.isArray(entry.labels)
          ? record(entry.labels[0])
          : record(entry.labels)
        const name =
          text(label?.displayName, 80) ??
          text(entry.displayName, 80) ??
          text(entry.name, 80)
        if (name && names.size < MAX_MENU_ITEMS) names.add(name)
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (key !== "items") visit(child, depth + 1)
    }
  }
  visit(payload, 0)
  return [...names]
}

/**
 * The venue's own facts from its stored address, its profile as Google
 * returned it, and the menu Google shows.
 */
export function venueContextFrom(input: {
  name: string
  address: unknown
  googleLocation: unknown
  menuPayload: unknown
}): VenueContext {
  const address = record(input.address)
  const google = record(input.googleLocation)
  const storefront = record(google?.storefrontAddress)
  const primary = record(record(google?.categories)?.primaryCategory)
  return {
    name: input.name,
    locality: text(address?.locality) ?? text(storefront?.locality),
    category: text(primary?.displayName),
    description: text(
      record(google?.profile)?.description,
      MAX_DESCRIPTION_CHARS
    ),
    menuItems: menuItemNames(input.menuPayload),
  }
}

export async function loadVenueContext(
  sql: TransactionSql,
  input: { locationId: string; locationName: string }
): Promise<VenueContext> {
  const [row] = await sql<
    { address: unknown; googleLocation: unknown; menuPayload: unknown }[]
  >`
    select
      l.address_json as address,
      (
        select s.observed_google_payload -> 'location'
        from presence_resource_reconcile_state s
        where s.location_id = l.id
          and s.resource in ('profile', 'businessInformation')
          and s.observed_google_payload -> 'location' is not null
        order by s.observed_at desc nulls last
        limit 1
      ) as "googleLocation",
      (
        -- The menu as Google shows it, not canonical_payload: saved but
        -- unpublished menu edits must not become facts for a public reply.
        select m.google_payload
        from food_menus_state m
        where m.location_id = l.id
        limit 1
      ) as "menuPayload"
    from location l
    where l.id = ${input.locationId}
  `
  return venueContextFrom({
    name: input.locationName,
    address: row?.address,
    googleLocation: row?.googleLocation,
    menuPayload: row?.menuPayload,
  })
}

export async function loadReplyContext(
  sql: TransactionSql,
  input: { reviewId: string; locationId: string; locationName: string }
): Promise<ReplyContext> {
  const venue = await loadVenueContext(sql, input)
  const others = await sql<{ name: string }[]>`
    select name from location where id <> ${input.locationId}
  `
  // The same window `storedReplyContentChecks` judges the stored draft by.
  const recent = await sql<{ body: string }[]>`
    select rr.current_body as body
    from review_reply rr
    join review r on r.id = rr.review_id
    join location l on l.id = r.location_id
    where l.client_id = (
        select client_id from location where id = ${input.locationId}
      )
      and r.id <> ${input.reviewId}
      and rr.publish_status = 'published'
      and rr.current_body is not null
    order by rr.google_reply_updated_at desc nulls last, rr.id desc
    limit 30
  `
  return {
    venue,
    otherLocationNames: others.map((location) => location.name),
    bannedPhrases: await loadBannedPhrases(sql),
    recentReplies: recent.map((row) => row.body),
  }
}
