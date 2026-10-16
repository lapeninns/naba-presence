import { randomUUID } from "node:crypto"

import postgres, { type TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  REVIEW_QUEUES,
  REVIEW_WORKFLOW_STATES,
  type ReviewQueue,
} from "@/lib/contracts/reviews"
import type { GooglePerformancePoint } from "@/lib/server/google"
import { sha256 } from "@/lib/server/crypto"
import {
  PERFORMANCE_UPSERT_CHUNK,
  upsertPerformancePoints,
} from "@/lib/server/performance"
import { visibilityPredicate } from "@/lib/server/permissions"
import {
  readReviewCounts,
  type ReviewCountsScope,
} from "@/lib/server/review-counts"
import { queuePredicate } from "@/lib/server/review-queues"
import {
  boundedSearchMatches,
  buildInboxQuery,
  SEARCH_MATCH_LIMIT,
} from "@/lib/server/reviews-query"
import type { Session } from "@/lib/server/session"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
  seedReview,
} from "./helpers/tenant"

type PlanNode = Record<string, unknown> & { Plans?: PlanNode[] }

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)]
}

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * W4-06, W4-07 and W4-09 (docs/audits/2026-10-14-full-stack-audit): the
 * counts query, inbox search and performance upserts were reshaped for cost.
 * Each test pins the new shape to the old one's results on the same data and
 * counts the statements it sends.
 */
describeDatabase("counts, search and metric write shape", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const statements: string[] = []
  const organisations: string[] = []

  async function asTenant<T>(
    organisationId: string,
    callback: (sql: TransactionSql) => Promise<T>
  ): Promise<{ result: T; statements: string[] }> {
    return runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationId}, true)`
      statements.length = 0
      const result = await callback(sql)
      return { result, statements: [...statements] }
    })
  }

  beforeAll(() => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, {
      max: 1,
      debug: (_connection, query) => {
        statements.push(query)
      },
    })
  })

  afterAll(async () => {
    if (admin) await destroyTenants(admin, organisations)
    await Promise.all([admin?.end(), runtime?.end()])
  })

  describe("review counts (W4-06)", () => {
    let organisationId: string
    let owner: Session
    let scopedMember: Session
    let clientId: string
    let clientLocationId: string

    function sessionFor(
      userId: string,
      role: Session["role"],
      canPublish: boolean
    ): Session {
      return {
        sessionId: randomUUID(),
        userId,
        organisationId,
        organisationName: "Harness tenant",
        workspaceMode: "agency",
        displayName: "Harness",
        email: "harness@nabapresence.test",
        role,
        canPublish,
      }
    }

    /** The three-statement implementation this change replaced, verbatim. */
    async function legacyCounts(
      sql: TransactionSql,
      session: Session,
      scope: ReviewCountsScope
    ) {
      const [settings] = await sql<{ requireTwoPersonApproval: boolean }[]>`
        select require_two_person_approval as "requireTwoPersonApproval"
        from organisation where id = ${session.organisationId}
      `
      const options = {
        requireTwoPersonApproval: settings?.requireTwoPersonApproval ?? false,
      }
      const filters = sql`
        r.provider_deleted_at is null
        ${scope.locationId ? sql`and r.location_id = ${scope.locationId}` : sql``}
        ${scope.clientId ? sql`and l.client_id = ${scope.clientId}` : sql``}
        and ${visibilityPredicate(sql, session, sql`r.location_id`)}
      `
      const queueColumns = REVIEW_QUEUES.map(
        (queue) =>
          sql`count(*) filter (where ${queuePredicate(sql, session, queue, options)})::integer as ${sql(queue)}`
      ).reduce((left, right) => sql`${left}, ${right}`)
      const [totals] = await sql<
        (Record<ReviewQueue, number> & { total: number })[]
      >`
        select count(*)::integer as total, ${queueColumns}
        from review r join location l on l.id = r.location_id
        where ${filters}
      `
      const statuses = await sql<{ workflowStatus: string; count: number }[]>`
        select r.workflow_status as "workflowStatus", count(*)::integer as count
        from review r join location l on l.id = r.location_id
        where ${filters}
        group by r.workflow_status
      `
      const groups = scope.groupBy
        ? await sql<
            (Record<ReviewQueue, number> & {
              clientId: string | null
              clientName: string
            })[]
          >`
            select c.id::text as "clientId",
              coalesce(c.name, 'Unassigned locations') as "clientName",
              ${queueColumns}
            from review r join location l on l.id = r.location_id
            left join client c on c.id = l.client_id
            where ${filters}
            group by c.id, c.name
            order by lower(coalesce(c.name, 'zzz'))
          `
        : undefined
      const byStatus = Object.fromEntries(
        REVIEW_WORKFLOW_STATES.map((status) => [status, 0])
      )
      for (const row of statuses) byStatus[row.workflowStatus] = row.count
      const pick = (row: Record<ReviewQueue, number> | undefined) =>
        Object.fromEntries(
          REVIEW_QUEUES.map((queue) => [queue, row?.[queue] ?? 0])
        )
      return {
        total: totals?.total ?? 0,
        byStatus,
        byQueue: pick(totals),
        groups: groups?.map((group) => ({
          clientId: group.clientId,
          clientName: group.clientName,
          byQueue: pick(group),
        })),
      }
    }

    async function setStatus(reviewId: string, path: string[]) {
      for (const status of path) {
        await admin`update review set workflow_status = ${status} where id = ${reviewId}`
      }
    }

    beforeAll(async () => {
      const tenant = await createTestTenant(admin)
      organisationId = tenant.organisationId
      organisations.push(organisationId)
      owner = sessionFor(tenant.userId, "owner", true)

      const reviews = []
      for (let index = 0; index < 9; index += 1) {
        reviews.push(await seedReview(admin, { organisationId }))
      }
      await setStatus(reviews[1].reviewId, ["drafted"])
      await setStatus(reviews[2].reviewId, ["published"])
      await setStatus(reviews[3].reviewId, [
        "drafted",
        "verified",
        "awaiting_approval",
      ])
      await setStatus(reviews[4].reviewId, [
        "drafted",
        "verified",
        "awaiting_approval",
      ])
      await setStatus(reviews[5].reviewId, ["published", "rejected"])
      await setStatus(reviews[6].reviewId, [
        "drafted",
        "verified",
        "publish_requested",
        "failed",
      ])
      await admin`update review set triaged_at = now() where id = ${reviews[7].reviewId}`
      await admin`update review set provider_deleted_at = now() where id = ${reviews[8].reviewId}`
      // One approval request came from the owner, so two-person approval
      // moves it from "awaiting my approval" to "awaiting others" for them.
      await admin`
        insert into review_reply (organisation_id, review_id, approval_requested_by)
        values (${organisationId}, ${reviews[3].reviewId}, ${tenant.userId})
      `

      const [client] = await admin<{ id: string }[]>`
        insert into client (organisation_id, name, slug)
        values (${organisationId}, 'Counts client', 'counts-client')
        returning id::text as id
      `
      clientId = client.id
      clientLocationId = reviews[3].locationId
      await admin`
        update location set client_id = ${clientId}
        where id in ${admin([reviews[3].locationId, reviews[4].locationId, reviews[0].locationId])}
      `

      const member = await seedMemberUser(admin, {
        organisationId,
        assignLocationId: reviews[4].locationId,
      })
      scopedMember = sessionFor(member.userId, "member", false)
    })

    const scopes: [string, () => ReviewCountsScope][] = [
      ["no scope", () => ({})],
      ["grouped by client", () => ({ groupBy: "client" })],
      ["one client", () => ({ clientId })],
      ["one client, grouped", () => ({ clientId, groupBy: "client" })],
      ["one location", () => ({ locationId: clientLocationId })],
    ]

    for (const twoPerson of [false, true]) {
      for (const [label, scope] of scopes) {
        it(`matches the old three-query result: ${label}, two-person ${twoPerson}`, async () => {
          await admin`
            update organisation set require_two_person_approval = ${twoPerson}
            where id = ${organisationId}
          `
          for (const session of [owner, scopedMember]) {
            if (session === scopedMember && scope().locationId) continue
            const legacy = await asTenant(organisationId, (sql) =>
              legacyCounts(sql, session, scope())
            )
            const current = await asTenant(organisationId, (sql) =>
              readReviewCounts(sql, session, scope())
            )
            // `approvableByMe` is newer than the old queries: it narrows the
            // awaiting_my_approval queue, never widens it.
            const { approvableByMe, ...rest } = current.result
            expect(rest).toEqual(legacy.result)
            expect(approvableByMe).toBeLessThanOrEqual(
              current.result.byQueue.awaiting_my_approval
            )
          }
        })
      }
    }

    it("reads the totals, statuses, queues and groups in one aggregate", async () => {
      const ungrouped = await asTenant(organisationId, (sql) =>
        readReviewCounts(sql, owner, {})
      )
      const grouped = await asTenant(organisationId, (sql) =>
        readReviewCounts(sql, owner, { groupBy: "client" })
      )
      const aggregates = (sent: string[]) =>
        sent.filter((query) => /from review r/.test(query))
      // Settings read plus one scan, where it used to be two or three scans.
      expect(ungrouped.statements).toHaveLength(2)
      expect(aggregates(ungrouped.statements)).toHaveLength(1)
      expect(grouped.statements).toHaveLength(2)
      expect(aggregates(grouped.statements)).toHaveLength(1)
      expect(grouped.result.total).toBe(ungrouped.result.total)
      expect(grouped.result.groups).toHaveLength(2)
    })
  })

  describe("inbox search (W4-07)", () => {
    let organisationId: string
    let otherOrganisationId: string
    const matches: Record<string, string> = {}

    const filtersFor = (search: string) => ({
      sort: "updated_desc" as const,
      pageSize: 100,
      role: "owner" as const,
      canPublish: true,
      requireTwoPersonApproval: false,
      userId: randomUUID(),
      search,
    })

    /** The production path: bounded GIN lookup, then the list query. */
    async function productionSearch(sql: TransactionSql, search: string) {
      return buildInboxQuery(sql, {
        ...filtersFor(search),
        searchReviewIds: await boundedSearchMatches(sql, search),
      })
    }

    beforeAll(async () => {
      organisationId = (await createTestTenant(admin)).organisationId
      otherOrganisationId = (await createTestTenant(admin)).organisationId
      organisations.push(organisationId, otherOrganisationId)
      const texts = {
        breakfast: "Excellent breakfast and friendly staff",
        dinner: "Dinner was cold but the breakfast was fine",
        quiet: "Quiet rooms, no complaints",
        deleted: "Excellent breakfast, since withdrawn",
      }
      for (const [key, text] of Object.entries(texts)) {
        matches[key] = (
          await seedReview(admin, { organisationId, text })
        ).reviewId
      }
      await admin`
        update review set provider_deleted_at = now() where id = ${matches.deleted}
      `
      await admin`
        update review
        set reviewer_display_name = 'Priya Sharma',
            google_review_id_hash = ${sha256("AbCdReviewId")},
            google_review_name_hash = ${sha256("accounts/1/locations/2/reviews/3")}
        where id = ${matches.quiet}
      `
      // More matches for one word than the bounded lookup will list, so the
      // inline-only path is exercised too.
      await admin`
        insert into review (
          organisation_id, location_id, external_location_id,
          google_review_name_ciphertext, google_review_name_hash,
          google_review_id_ciphertext, google_review_id_hash,
          reviewer_display_name, star_rating, review_text, create_time,
          update_time, content_hash, workflow_status, raw_payload
        )
        select
          r.organisation_id, r.location_id, r.external_location_id,
          r.google_review_name_ciphertext, 'crowded-name-' || n,
          r.google_review_id_ciphertext, 'crowded-id-' || n,
          'Crowd ' || n, 5, 'Crowded terrace review ' || n,
          now() - n * interval '1 minute', now() - n * interval '1 minute',
          'crowded-' || n, 'new', '{}'::jsonb
        from review r, generate_series(1, ${SEARCH_MATCH_LIMIT + 5}) n
        where r.id = ${matches.quiet}
      `
      // The same words in another tenant must never be returned.
      matches.foreign = (
        await seedReview(admin, {
          organisationId: otherOrganisationId,
          text: "Excellent breakfast elsewhere",
        })
      ).reviewId
      await admin`
        update review set google_review_id_hash = ${sha256("AbCdReviewId")}
        where id = ${matches.foreign}
      `
    })

    const searches = [
      "excellent breakfast",
      "breakfast",
      "breakfast -dinner",
      '"friendly staff"',
      "dinner or quiet",
      "priya",
      "AbCdReviewId",
      "accounts/1/locations/2/reviews/3",
      "nothing matches this",
      "crowded",
      "crowded or breakfast",
    ]

    for (const search of searches) {
      it(`returns the page search_review_ids returned: ${search}`, async () => {
        const { result } = await asTenant(organisationId, async (sql) => {
          const inline = await buildInboxQuery(sql, filtersFor(search))
          const production = await productionSearch(sql, search)
          const legacy = await sql<{ id: string }[]>`
            select r.id::text as id
            from review r
            join search_review_ids(${organisationId}, ${search}, ${sha256(search)}) m
              on m.review_id = r.id
            where r.provider_deleted_at is null
            order by r.update_time desc, r.id desc
            limit 101
          `
          return {
            inline: inline.map((row) => row.id),
            production: production.map((row) => row.id),
            legacy: legacy.map((row) => row.id),
          }
        })
        expect(result.inline).toEqual(result.legacy)
        expect(result.production).toEqual(result.legacy)
        expect(result.production).not.toContain(matches.foreign)
        expect(result.production).not.toContain(matches.deleted)
      })
    }

    it("lists few matches and declines to list many", async () => {
      const { result } = await asTenant(organisationId, async (sql) => ({
        breakfast: await boundedSearchMatches(sql, "breakfast"),
        crowded: await boundedSearchMatches(sql, "crowded"),
        absent: await boundedSearchMatches(sql, "nothing matches this"),
      }))
      // Tombstones are matches too; the list query drops them.
      expect(result.breakfast?.sort()).toEqual(
        [matches.breakfast, matches.dinner, matches.deleted].sort()
      )
      expect(result.crowded).toBeUndefined()
      expect(result.absent).toEqual([])
    })

    it("finds the expected rows", async () => {
      const ids = async (search: string) =>
        (
          await asTenant(organisationId, (sql) => productionSearch(sql, search))
        ).result.map((row) => row.id)
      expect((await ids("breakfast")).sort()).toEqual(
        [matches.breakfast, matches.dinner].sort()
      )
      expect(await ids("breakfast -dinner")).toEqual([matches.breakfast])
      expect(await ids("AbCdReviewId")).toEqual([matches.quiet])
      expect(await ids("priya")).toEqual([matches.quiet])
      expect(await ids("crowded")).toHaveLength(101)
    })

    it("plans the search beside the tenant filter, with no function scan", async () => {
      const plan = async (search: string) =>
        (
          await asTenant(organisationId, async (sql) => {
            const ids = await boundedSearchMatches(sql, search)
            const query = buildInboxQuery(sql, {
              ...filtersFor(search),
              searchReviewIds: ids,
            })
            const [row] = await sql<{ "QUERY PLAN": [{ Plan: PlanNode }] }[]>`
              explain (format json) ${query}
            `
            return flatten(row["QUERY PLAN"][0].Plan)
          })
        ).result
      for (const [search, listed] of [
        ["excellent breakfast", true],
        ["crowded", false],
      ] as const) {
        const nodes = await plan(search)
        const text = JSON.stringify(nodes)
        expect(text).not.toContain("Function Scan")
        // The review scan carries the tenant condition and the search, and
        // a listed search also the ids, so the planner starts from a tenant-
        // leading index or the primary key and never from another tenant.
        const reviewScans = nodes.filter(
          (node) => node["Relation Name"] === "review"
        )
        expect(reviewScans).toHaveLength(1)
        const conditions = JSON.stringify(reviewScans[0])
        expect(conditions).toMatch(
          /organisation_id = \(NULLIF\(current_setting/
        )
        expect(conditions).toContain("search_document @@")
        expect(conditions.includes("id = ANY")).toBe(listed)
      }
    })

    it("refuses a bounded search for a different tenant", async () => {
      await expect(
        asTenant(
          organisationId,
          (sql) =>
            sql`
            select review_id
            from search_review_ids_bounded(
              ${otherOrganisationId}, 'breakfast', 'not-a-real-hash', 10
            )
          `
        )
      ).rejects.toThrow(/tenant/i)
    })
  })

  describe("performance metric upserts (W4-09)", () => {
    let organisationId: string
    let legacyLocationId: string
    let batchedLocationId: string

    /** ~18 months of all 11 metrics: a first sync's worth of points. */
    function firstSyncPoints(): GooglePerformancePoint[] {
      const metrics = [
        "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
        "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
        "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
        "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
        "CALL_CLICKS",
        "WEBSITE_CLICKS",
        "BUSINESS_DIRECTION_REQUESTS",
        "BUSINESS_CONVERSATIONS",
        "BUSINESS_BOOKINGS",
        "BUSINESS_FOOD_ORDERS",
        "BUSINESS_FOOD_MENU_CLICKS",
      ] as const
      const points: GooglePerformancePoint[] = []
      const start = Date.UTC(2025, 0, 31)
      for (const [index, metric] of metrics.entries()) {
        for (let day = 0; day < 548; day += 1) {
          points.push({
            metric,
            date: new Date(start + day * 86_400_000).toISOString().slice(0, 10),
            value: (day * 7 + index) % 23,
          })
        }
      }
      return points
    }

    /** The per-point loop this change replaced, verbatim. */
    async function legacyUpsert(
      sql: TransactionSql,
      externalLocationId: string,
      points: GooglePerformancePoint[]
    ) {
      for (const point of points) {
        await sql`
          insert into performance_metric_daily (
            organisation_id, external_location_id, metric, metric_date, value
          )
          values (
            ${organisationId}, ${externalLocationId}, ${point.metric},
            ${point.date}, ${point.value}
          )
          on conflict (organisation_id, external_location_id, metric, metric_date)
          do update set value = excluded.value
        `
      }
    }

    async function storedRows(externalLocationId: string) {
      return admin<
        { metric: string; date: string; value: string; version: string }[]
      >`
        select metric, metric_date::text as date, value::text as value,
          xmin::text as version
        from performance_metric_daily
        where external_location_id = ${externalLocationId}
        order by metric, metric_date
      `
    }

    const withoutVersion = (rows: Awaited<ReturnType<typeof storedRows>>) =>
      rows.map(({ metric, date, value }) => ({ metric, date, value }))

    beforeAll(async () => {
      organisationId = (await createTestTenant(admin)).organisationId
      organisations.push(organisationId)
      const connection = await seedGoogleConnection(admin, { organisationId })
      legacyLocationId = (
        await seedLinkedLocation(admin, { organisationId, ...connection })
      ).externalLocationId
      batchedLocationId = (
        await seedLinkedLocation(admin, { organisationId, ...connection })
      ).externalLocationId
    })

    it("stores the same rows as the per-point loop in ceil(n / chunk) statements", async () => {
      const points = firstSyncPoints()
      expect(points).toHaveLength(6_028)

      const legacy = await asTenant(organisationId, (sql) =>
        legacyUpsert(sql, legacyLocationId, points)
      )
      const batched = await asTenant(organisationId, (sql) =>
        upsertPerformancePoints(sql, organisationId, batchedLocationId, points)
      )

      expect(legacy.statements).toHaveLength(6_028)
      expect(batched.statements).toHaveLength(
        Math.ceil(points.length / PERFORMANCE_UPSERT_CHUNK)
      )
      expect(batched.statements).toHaveLength(7)
      const stored = await storedRows(batchedLocationId)
      expect(stored).toHaveLength(6_028)
      expect(withoutVersion(stored)).toEqual(
        withoutVersion(await storedRows(legacyLocationId))
      )
    })

    it("leaves unchanged rows untouched and applies restated values", async () => {
      const points = firstSyncPoints()
      const before = await storedRows(batchedLocationId)

      await asTenant(organisationId, (sql) =>
        upsertPerformancePoints(sql, organisationId, batchedLocationId, points)
      )
      // Same values: no row gets a new version.
      expect(await storedRows(batchedLocationId)).toEqual(before)

      // A restatement, sent twice in one response: the last value wins, as
      // it did point by point, and only that row is rewritten.
      const restated = points[100]
      await asTenant(organisationId, (sql) =>
        upsertPerformancePoints(sql, organisationId, batchedLocationId, [
          ...points,
          { ...restated, value: 900 },
          { ...restated, value: 901 },
        ])
      )
      const after = await storedRows(batchedLocationId)
      const changed = after.filter(
        (row, index) => row.version !== before[index].version
      )
      expect(changed).toEqual([
        expect.objectContaining({
          metric: restated.metric,
          date: restated.date,
          value: "901",
        }),
      ])
    })
  })
})
