import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { createTestTenant, destroyTenants, seedReview } from "./helpers/tenant"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const TARGET = "https://search.google.com/local/writereview?placeid=harness"
const BASE = "https://app.example.test"

type Tenant = Awaited<ReturnType<typeof createTestTenant>>

/**
 * Review links against a real schema (migration 0152): the runtime role,
 * RLS, the SECURITY DEFINER lookup and the click counter, with two
 * organisations so nothing of one is reachable from the other.
 */
describeDatabase("review links", () => {
  let admin: ReturnType<typeof postgres>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "review-links-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY =
      "review-links-test-token-key-32-characters"
    process.env.CRON_SECRET = "review-links-test-cron-secret"
    // Read once per process (getServerEnv): only requests that send this
    // header have a client IP, so only the budget test is ever limited.
    process.env.ABUSE_LIMITS_ENABLED = "true"
    process.env.CLIENT_IP_HEADER = "x-test-client-ip"
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function tenant(
    options: Parameters<typeof createTestTenant>[1] = {}
  ): Promise<Tenant> {
    const created = await createTestTenant(admin, options)
    organisations.push(created.organisationId)
    return created
  }

  function sessionOf(
    t: Tenant,
    role: "owner" | "admin" | "member" | "viewer" = "owner"
  ) {
    return {
      sessionId: randomUUID(),
      userId: t.userId,
      organisationId: t.organisationId,
      organisationName: "Harness tenant",
      workspaceMode: "agency" as const,
      displayName: "Harness",
      email: t.email,
      role,
      canPublish: role !== "viewer",
    }
  }

  /** A location with a stored profile read carrying Google's review form. */
  async function locationWithTarget(
    t: Tenant,
    target: string | null = TARGET,
    resource: "profile" | "businessInformation" = "profile"
  ) {
    const { locationId } = await seedReview(admin, {
      organisationId: t.organisationId,
    })
    await admin`
      insert into presence_resource_reconcile_state (
        organisation_id, location_id, resource, status, observed_google_payload
      ) values (
        ${t.organisationId}, ${locationId}, ${resource}, 'succeeded',
        ${admin.json({
          observedAt: new Date().toISOString(),
          location: { metadata: target ? { newReviewUri: target } : {} },
        })}
      )
    `
    return locationId
  }

  async function modules() {
    const { withTenant } = await import("@/lib/server/db")
    const links = await import("@/lib/server/review-links")
    return { withTenant, ...links }
  }

  async function create(t: Tenant, locationId: string, caption?: string) {
    const { withTenant, createReviewLink } = await modules()
    return withTenant(t.organisationId, (sql) =>
      createReviewLink(sql, {
        session: sessionOf(t),
        locationId,
        requestId: randomUUID(),
        baseUrl: BASE,
        caption,
      })
    )
  }

  async function update(
    t: Tenant,
    locationId: string,
    action: Parameters<
      Awaited<ReturnType<typeof modules>>["updateReviewLink"]
    >[1]["action"],
    role: Parameters<typeof sessionOf>[1] = "owner"
  ) {
    const { withTenant, updateReviewLink } = await modules()
    return withTenant(t.organisationId, (sql) =>
      updateReviewLink(sql, {
        session: sessionOf(t, role),
        locationId,
        requestId: randomUUID(),
        baseUrl: BASE,
        action,
      })
    )
  }

  it("creates one link per location from the stored Google read, idempotently", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    const first = await create(t, locationId, "Leave us a review on Google")
    expect(first.created).toBe(true)
    expect(first.link).toMatchObject({
      targetUri: TARGET,
      status: "live",
      caption: "Leave us a review on Google",
      url: `${BASE}/r/${first.link.code}`,
      qrUrl: `${BASE}/r/${first.link.code}?s=qr`,
    })
    expect(first.link.code).toMatch(/^[2-9a-hjkmnp-z]{10}$/)
    const again = await create(t, locationId)
    expect(again).toEqual({ link: first.link, created: false })
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where organisation_id = ${t.organisationId}
        and action = 'review_link.created'
    `
    expect(audit?.count).toBe(1)
  })

  it("falls back to the Business Information read for the target", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(
      t,
      TARGET,
      "businessInformation"
    )
    expect((await create(t, locationId)).link.targetUri).toBe(TARGET)
  })

  it("takes the newest stored read's review form, in the state and the summary", async () => {
    const t = await tenant()
    const { withTenant, readReviewLinkState } = await modules()
    const { readListingSummaries } =
      await import("@/lib/server/location-summary")
    const MOVED = `${TARGET}-moved`
    const observe = (
      locationId: string,
      resource: "profile" | "businessInformation",
      target: string,
      observedAt: Date
    ) => admin`
      insert into presence_resource_reconcile_state (
        organisation_id, location_id, resource, status, observed_at,
        observed_google_payload
      ) values (
        ${t.organisationId}, ${locationId}, ${resource}, 'succeeded',
        ${observedAt},
        ${admin.json({
          observedAt: observedAt.toISOString(),
          location: { metadata: { newReviewUri: target } },
        })}
      )
      on conflict (organisation_id, location_id, resource) do update set
        observed_at = excluded.observed_at,
        observed_google_payload = excluded.observed_google_payload
    `
    const stateOf = (locationId: string) =>
      withTenant(t.organisationId, (sql) =>
        readReviewLinkState(sql, sessionOf(t), locationId, BASE)
      )
    const summaryOf = async (locationId: string) => {
      const [summary] = await withTenant(t.organisationId, (sql) =>
        readListingSummaries(sql, sessionOf(t), [locationId])
      )
      return summary?.reviewLink
    }
    const { locationId } = await seedReview(admin, {
      organisationId: t.organisationId,
    })
    const earlier = new Date(Date.now() - 60 * 60 * 1000)
    const later = new Date()
    await observe(locationId, "profile", TARGET, earlier)
    await observe(locationId, "businessInformation", TARGET, earlier)
    await create(t, locationId)

    // "Check for a new review form" refreshes Business Information only:
    // its newer read wins over the older profile read.
    await observe(locationId, "businessInformation", MOVED, later)
    expect(await stateOf(locationId)).toMatchObject({
      googleTarget: MOVED,
      targetChanged: true,
    })
    expect(await summaryOf(locationId)).toEqual({
      status: "live",
      targetChanged: true,
    })
    const synced = await update(t, locationId, { action: "sync_target" })
    expect(synced.targetUri).toBe(MOVED)
    expect(await summaryOf(locationId)).toEqual({
      status: "live",
      targetChanged: false,
    })

    // The reverse: a profile read newer still wins over Business Information.
    await observe(locationId, "profile", TARGET, new Date(Date.now() + 1000))
    expect(await stateOf(locationId)).toMatchObject({
      googleTarget: TARGET,
      targetChanged: true,
    })
    expect(await summaryOf(locationId)).toEqual({
      status: "live",
      targetChanged: true,
    })
  })

  it("refuses to create a link when Google hasn't given a review form", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t, null)
    await expect(create(t, locationId)).rejects.toMatchObject({
      status: 409,
      code: "review_link_target_missing",
    })
    const { withTenant, readReviewLinkState } = await modules()
    const state = await withTenant(t.organisationId, (sql) =>
      readReviewLinkState(sql, sessionOf(t), locationId, BASE)
    )
    expect(state).toEqual({
      link: null,
      googleTarget: null,
      targetChanged: false,
      canManage: true,
    })
  })

  it("refuses a gating caption and saves nothing", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    await expect(
      create(t, locationId, "Rate us 5 stars for a free pint")
    ).rejects.toMatchObject({
      status: 422,
      code: "review_link_caption_rejected",
    })
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from review_link where location_id = ${locationId}
    `
    expect(row?.count).toBe(0)
  })

  it("resolves a live code, counts the click, and stores no guest data", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    const { link } = await create(t, locationId)
    const { resolveReviewLink, recordReviewLinkClick } = await modules()
    const resolved = await resolveReviewLink(link.code)
    expect(resolved).toEqual({
      linkId: link.id,
      organisationId: t.organisationId,
      targetUri: TARGET,
    })
    await recordReviewLinkClick(resolved!, "qr")
    await recordReviewLinkClick(resolved!, "link")
    const clicks = await admin<{ source: string }[]>`
      select source from review_link_click where link_id = ${link.id} order by id
    `
    expect(clicks.map((click) => click.source)).toEqual(["qr", "link"])
    const columns = await admin<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'review_link_click' order by ordinal_position
    `
    expect(columns.map((column) => column.column_name)).toEqual([
      "id",
      "organisation_id",
      "link_id",
      "clicked_at",
      "source",
    ])
  })

  it("rotates the code: the old one stops resolving, the history stays", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    const { link } = await create(t, locationId)
    const { resolveReviewLink, recordReviewLinkClick } = await modules()
    await recordReviewLinkClick((await resolveReviewLink(link.code))!, "link")
    const rotated = await update(t, locationId, { action: "rotate" })
    expect(rotated.code).not.toBe(link.code)
    expect(rotated.id).toBe(link.id)
    expect(rotated.rotatedAt).not.toBeNull()
    expect(await resolveReviewLink(link.code)).toBeNull()
    expect(await resolveReviewLink(rotated.code)).toMatchObject({
      linkId: link.id,
    })
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from review_link_click where link_id = ${link.id}
    `
    expect(row?.count).toBe(1)
  })

  it("switches a link off and back on", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    const { link } = await create(t, locationId)
    const { resolveReviewLink } = await modules()
    const off = await update(t, locationId, { action: "disable" })
    expect(off.status).toBe("off")
    expect(await resolveReviewLink(link.code)).toBeNull()
    const on = await update(t, locationId, { action: "enable" })
    expect(on).toMatchObject({ status: "live", code: link.code })
    expect(await resolveReviewLink(link.code)).not.toBeNull()
  })

  it("lets only an owner or admin make a new link or switch it off", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    const { link } = await create(t, locationId)
    const { resolveReviewLink } = await modules()

    // A member who may edit the listing: both break printed codes, so 403,
    // and nothing changes.
    for (const action of ["rotate", "disable"] as const) {
      await expect(
        update(t, locationId, { action }, "member")
      ).rejects.toMatchObject({ status: 403, code: "permission_denied" })
    }
    expect(await resolveReviewLink(link.code)).toMatchObject({
      linkId: link.id,
    })
    // The rest stays with anyone who may edit.
    expect(
      (
        await update(
          t,
          locationId,
          { action: "caption", caption: "Thanks for visiting" },
          "member"
        )
      ).caption
    ).toBe("Thanks for visiting")

    // An admin may do both.
    const rotated = await update(t, locationId, { action: "rotate" }, "admin")
    expect(rotated.code).not.toBe(link.code)
    const off = await update(t, locationId, { action: "disable" }, "admin")
    expect(off.status).toBe("off")
    // Switching back on breaks nothing: a member may.
    expect(
      (await update(t, locationId, { action: "enable" }, "member")).status
    ).toBe("live")
  })

  it("follows Google's new review form when asked", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    await create(t, locationId)
    const next = "https://g.page/r/harness-next/review"
    await admin`
      update presence_resource_reconcile_state
      set observed_google_payload = ${admin.json({
        observedAt: new Date().toISOString(),
        location: { metadata: { newReviewUri: next } },
      })}
      where location_id = ${locationId} and resource = 'profile'
    `
    const { withTenant, readReviewLinkState } = await modules()
    const before = await withTenant(t.organisationId, (sql) =>
      readReviewLinkState(sql, sessionOf(t), locationId, BASE)
    )
    expect(before).toMatchObject({ googleTarget: next, targetChanged: true })
    expect(
      (await update(t, locationId, { action: "sync_target" })).targetUri
    ).toBe(next)
  })

  it("never redirects to a stored target outside Google's review hosts", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    const { link } = await create(t, locationId)
    await admin`
      update review_link set target_uri = 'https://evil.example/review'
      where id = ${link.id}
    `
    const { resolveReviewLink } = await modules()
    expect(await resolveReviewLink(link.code)).toBeNull()
  })

  it("keeps one organisation's links out of another's reach", async () => {
    const a = await tenant()
    const b = await tenant()
    const locationA = await locationWithTarget(a)
    const { link } = await create(a, locationA)
    const { withTenant, readReviewLinkState, readReviewLinkStats } =
      await modules()
    // B's owner holds a grant for any id (grantsFor), so the location row
    // itself must answer: A's location is a 404 to B, not an empty state.
    await expect(
      withTenant(b.organisationId, (sql) =>
        readReviewLinkState(sql, sessionOf(b), locationA, BASE)
      )
    ).rejects.toMatchObject({ status: 404, code: "location_not_found" })
    await expect(
      withTenant(b.organisationId, (sql) =>
        readReviewLinkStats(sql, locationA, 30)
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      update(b, locationA, { action: "disable" })
    ).rejects.toMatchObject({ status: 404 })
    const visible = await withTenant(
      b.organisationId,
      (sql) => sql`select id from review_link where id = ${link.id}`
    )
    expect(visible).toHaveLength(0)
    // The public lookup still resolves A's code: it is public by design.
    const { resolveReviewLink } = await modules()
    expect(await resolveReviewLink(link.code)).not.toBeNull()
  })

  it("lets a viewer read the state but not manage it", async () => {
    const t = await tenant({ role: "viewer" })
    const locationId = await locationWithTarget(t)
    const { withTenant, readReviewLinkState } = await modules()
    const state = await withTenant(t.organisationId, (sql) =>
      readReviewLinkState(sql, sessionOf(t, "viewer"), locationId, BASE)
    )
    expect(state.canManage).toBe(false)
  })

  it("counts clicks and new reviews per local day", async () => {
    const t = await tenant()
    const locationId = await locationWithTarget(t)
    const { link } = await create(t, locationId)
    await admin`update location set timezone = 'Europe/London' where id = ${locationId}`
    const now = new Date("2026-10-30T12:00:00Z")
    await admin`
      insert into review_link_click (organisation_id, link_id, clicked_at, source)
      values
        (${t.organisationId}, ${link.id}, '2026-10-30T09:00:00Z', 'qr'),
        (${t.organisationId}, ${link.id}, '2026-10-30T10:00:00Z', 'link'),
        (${t.organisationId}, ${link.id}, '2026-10-29T23:30:00Z', 'qr'),
        (${t.organisationId}, ${link.id}, '2026-08-05T12:00:00Z', 'qr')
    `
    await admin`
      update review set create_time = '2026-10-30T08:00:00Z'
      where location_id = ${locationId}
    `
    const { withTenant, readReviewLinkStats } = await modules()
    const stats = await withTenant(t.organisationId, (sql) =>
      readReviewLinkStats(sql, locationId, 30, now)
    )
    expect(stats).toMatchObject({
      days: 30,
      timeZone: "Europe/London",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      totals: { clicks: 3, qrClicks: 2, newReviews: 1 },
    })
    expect(stats.series).toHaveLength(30)
    expect(stats.series.at(-1)).toEqual({
      date: "2026-10-30",
      clicks: 2,
      qrClicks: 1,
      newReviews: 1,
    })
    // 23:30 UTC on the 29th is still the 29th in London (GMT from 25 Oct).
    expect(stats.series.at(-2)).toMatchObject({ date: "2026-10-29", clicks: 1 })
    const ninety = await withTenant(t.organisationId, (sql) =>
      readReviewLinkStats(sql, locationId, 90, now)
    )
    expect(ninety.totals.clicks).toBe(4)
  })

  it("puts the link's status in the listing summary, from the database alone", async () => {
    const t = await tenant()
    const { withTenant } = await modules()
    const { readListingSummaries } =
      await import("@/lib/server/location-summary")
    const statusOf = async (locationId: string) => {
      const [summary] = await withTenant(t.organisationId, (sql) =>
        readListingSummaries(sql, sessionOf(t), [locationId])
      )
      return summary?.reviewLink
    }
    const noForm = await locationWithTarget(t, null)
    expect(await statusOf(noForm)).toEqual({
      status: "no_review_form",
      targetChanged: false,
    })
    const locationId = await locationWithTarget(t)
    expect(await statusOf(locationId)).toEqual({
      status: "not_set_up",
      targetChanged: false,
    })
    await create(t, locationId)
    expect(await statusOf(locationId)).toEqual({
      status: "live",
      targetChanged: false,
    })
    // Google moves its review form: the stored read changes, the link doesn't.
    await admin`
      update presence_resource_reconcile_state
      set observed_google_payload = ${admin.json({
        observedAt: new Date().toISOString(),
        location: { metadata: { newReviewUri: `${TARGET}-moved` } },
      })}
      where location_id = ${locationId} and resource = 'profile'
    `
    expect(await statusOf(locationId)).toEqual({
      status: "live",
      targetChanged: true,
    })
    await update(t, locationId, { action: "disable" })
    expect(await statusOf(locationId)).toEqual({
      status: "off",
      targetChanged: true,
    })
    // The board's read (no ids) carries it too.
    const all = await withTenant(t.organisationId, (sql) =>
      readListingSummaries(sql, sessionOf(t))
    )
    expect(
      all.find((summary) => summary.locationId === noForm)?.reviewLink?.status
    ).toBe("no_review_form")
  })

  it("takes the public budget per client IP and refuses past the limit", async () => {
    const { takeReviewLinkBudget } = await modules()
    const { ABUSE_POLICIES } = await import("@/lib/server/abuse-limits")
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    const request = () =>
      new Request(`${BASE}/r/abcdefghjk`, {
        headers: { "x-test-client-ip": ip },
      })
    try {
      for (let hit = 0; hit < ABUSE_POLICIES.review_link.ip.limit; hit += 1) {
        expect((await takeReviewLinkBudget(request())).allowed).toBe(true)
      }
      const refused = await takeReviewLinkBudget(request())
      expect(refused.allowed).toBe(false)
      expect(refused.retryAfterSeconds).toBeGreaterThan(0)
    } finally {
      await admin`delete from abuse_rate_bucket where scope = 'review_link_ip'`
    }
  })
})
