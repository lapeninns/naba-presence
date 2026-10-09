import { PGlite } from "@electric-sql/pglite"
import postgres from "postgres"
import type { TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import {
  clientVisibilityPredicate,
  visibilityPredicate,
  type ReportViewer,
} from "@/lib/server/permissions"
import { loadPresenceReport } from "@/lib/server/presence-report"
import { loadSharedClientReport } from "@/lib/server/shared-report"

import { pgliteSql, render } from "./helpers/pglite-sql"

vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({}),
  gbpIngestionEnabled: () => true,
}))

// The public client report must never show another client's figures. These
// tests run the real loaders against PostgreSQL (PGlite) with two clients and
// an unassigned location in one organisation, and assert that the report for
// client A contains A's figures and nothing of B's or the unassigned one's --
// through the shared-report loader, and through each of its two independent
// narrowings (the share viewer's visibility, and the clientId filter) alone.

const ORG = "00000000-0000-4000-8000-000000000001"
const CLIENT_A = "aaaaaaaa-0000-4000-8000-000000000001"
const CLIENT_B = "bbbbbbbb-0000-4000-8000-000000000001"
const LOC_A = "aaaaaaaa-1111-4000-8000-000000000001"
const LOC_B = "bbbbbbbb-1111-4000-8000-000000000001"
const LOC_FREE = "cccccccc-1111-4000-8000-000000000001"
const EXT_A = "aaaaaaaa-2222-4000-8000-000000000001"
const EXT_B = "bbbbbbbb-2222-4000-8000-000000000001"
const EXT_FREE = "cccccccc-2222-4000-8000-000000000001"

const NOW = new Date("2026-09-20T12:00:00.000Z")

const shareA: ReportViewer = {
  kind: "client_share",
  clientId: CLIENT_A,
  organisationId: ORG,
}

let db: PGlite
let sql: TransactionSql

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create table organisation (
      id uuid primary key, name text not null,
      default_timezone text not null default 'Europe/London'
    );
    create table client (
      id uuid primary key, organisation_id uuid not null,
      name text not null, notes text, archived_at timestamptz
    );
    create table location (
      id uuid primary key, organisation_id uuid not null,
      client_id uuid, name text not null
    );
    create table location_member (
      location_id uuid not null, user_id uuid not null,
      can_publish boolean not null default false
    );
    create table review (
      id uuid primary key default gen_random_uuid(),
      location_id uuid not null, star_rating integer,
      create_time timestamptz not null, provider_deleted_at timestamptz,
      reviewer_display_name text, comment text
    );
    create table review_reply (
      id uuid primary key default gen_random_uuid(),
      review_id uuid not null, publish_status text,
      first_published_at timestamptz, google_reply_updated_at timestamptz,
      body text
    );
    create table draft (
      id uuid primary key default gen_random_uuid(),
      review_id uuid not null, verification_status text,
      created_at timestamptz not null default now()
    );
    create table external_location (
      id uuid primary key, google_average_rating numeric(3, 2),
      google_total_review_count integer,
      provider_totals_refreshed_at timestamptz
    );
    create table location_link (
      id uuid primary key default gen_random_uuid(),
      location_id uuid not null, external_location_id uuid not null,
      is_active boolean not null default true
    );
    create table performance_metric_daily (
      external_location_id uuid not null, metric text not null,
      metric_date date not null, value numeric not null
    );
    create table sync_checkpoint (
      external_location_id uuid not null, sync_type text not null,
      status text not null, last_error_code text
    );

    insert into organisation (id, name) values ('${ORG}', 'Harbour Agency');
    insert into client (id, organisation_id, name, notes) values
      ('${CLIENT_A}', '${ORG}', 'Old Crown Group', 'internal: late payer'),
      ('${CLIENT_B}', '${ORG}', 'Bella Vita', null);
    insert into location (id, organisation_id, client_id, name) values
      ('${LOC_A}', '${ORG}', '${CLIENT_A}', 'Old Crown, Sutton'),
      ('${LOC_B}', '${ORG}', '${CLIENT_B}', 'Bella Vita, Leeds'),
      ('${LOC_FREE}', '${ORG}', null, 'Unfiled Diner');
    insert into external_location (id, google_average_rating, google_total_review_count, provider_totals_refreshed_at) values
      ('${EXT_A}', 4.00, 2, now()),
      ('${EXT_B}', 1.00, 500, now()),
      ('${EXT_FREE}', 3.00, 80, now());
    insert into location_link (location_id, external_location_id) values
      ('${LOC_A}', '${EXT_A}'), ('${LOC_B}', '${EXT_B}'), ('${LOC_FREE}', '${EXT_FREE}');

    -- Client A: two reviews in the window, one answered.
    insert into review (id, location_id, star_rating, create_time, reviewer_display_name, comment) values
      ('aaaaaaaa-3333-4000-8000-000000000001', '${LOC_A}', 5, '2026-09-10T10:00:00Z', 'Alice A', 'Lovely'),
      ('aaaaaaaa-3333-4000-8000-000000000002', '${LOC_A}', 3, '2026-09-11T10:00:00Z', 'Arthur A', 'Fine');
    insert into review_reply (review_id, publish_status, first_published_at, body) values
      ('aaaaaaaa-3333-4000-8000-000000000001', 'published', '2026-09-10T12:00:00Z', 'Thanks Alice');

    -- Client B and the unassigned location: many one-star reviews.
    insert into review (location_id, star_rating, create_time, reviewer_display_name, comment)
      select '${LOC_B}', 1, '2026-09-12T10:00:00Z', 'Bob B', 'Awful' from generate_series(1, 7);
    insert into review (location_id, star_rating, create_time, reviewer_display_name, comment)
      select '${LOC_FREE}', 2, '2026-09-12T10:00:00Z', 'Fran F', 'Meh' from generate_series(1, 4);

    insert into performance_metric_daily values
      ('${EXT_A}', 'CALL_CLICKS', '2026-09-10', 3),
      ('${EXT_A}', 'WEBSITE_CLICKS', '2026-09-10', 5),
      ('${EXT_B}', 'CALL_CLICKS', '2026-09-10', 1000),
      ('${EXT_FREE}', 'CALL_CLICKS', '2026-09-10', 2000);
    insert into sync_checkpoint values
      ('${EXT_A}', 'performance', 'succeeded', null),
      ('${EXT_B}', 'performance', 'failed', 'PERMISSION_DENIED_B');
  `)
  sql = pgliteSql(db).sql
})

afterAll(async () => {
  await db.close()
})

describe("loadSharedClientReport", () => {
  it("returns client A's figures and names only", async () => {
    const report = await loadSharedClientReport(
      sql,
      { organisationId: ORG, clientId: CLIENT_A },
      "28d",
      NOW
    )
    expect(report).not.toBeNull()
    expect(report!.agencyName).toBe("Harbour Agency")
    expect(report!.clientName).toBe("Old Crown Group")
    expect(report!.venues).toEqual(["Old Crown, Sutton"])
    expect(report!.replies.summary).toEqual({
      reviewVolume: 2,
      averageRating: 4,
      responseRate: 50,
      medianFirstResponseSeconds: 7200,
    })
    expect(report!.replies.locations.map((row) => row.name)).toEqual([
      "Old Crown, Sutton",
    ])
    expect(
      report!.replies.series.reduce((sum, point) => sum + point.reviewCount, 0)
    ).toBe(2)
    expect(report!.google?.totals.CALL_CLICKS).toBe(3)
    expect(report!.google?.totals.WEBSITE_CLICKS).toBe(5)
  })

  it("serialises nothing of another client, reviewers, text, notes or ids", async () => {
    const report = await loadSharedClientReport(
      sql,
      { organisationId: ORG, clientId: CLIENT_A },
      "28d",
      NOW
    )
    const wire = JSON.stringify(report)
    for (const forbidden of [
      "Bella Vita",
      "Unfiled Diner",
      "Bob B",
      "Alice A",
      "Lovely",
      "Thanks Alice",
      "late payer",
      "PERMISSION_DENIED_B",
      ORG,
      CLIENT_A,
      CLIENT_B,
      LOC_A,
      LOC_B,
      EXT_A,
    ]) {
      expect(wire).not.toContain(forbidden)
    }
  })

  it("returns client B's figures for client B's link, and none of A's", async () => {
    const report = await loadSharedClientReport(
      sql,
      { organisationId: ORG, clientId: CLIENT_B },
      "28d",
      NOW
    )
    expect(report!.venues).toEqual(["Bella Vita, Leeds"])
    expect(report!.replies.summary.reviewVolume).toBe(7)
    // B has metric rows, so it is ready, and A's 3 calls are not in it.
    expect(report!.google?.totals.CALL_CLICKS).toBe(1000)
  })

  it("answers null for an archived client", async () => {
    await db.exec(
      `update client set archived_at = now() where id = '${CLIENT_B}'`
    )
    try {
      await expect(
        loadSharedClientReport(
          sql,
          { organisationId: ORG, clientId: CLIENT_B },
          "28d",
          NOW
        )
      ).resolves.toBeNull()
    } finally {
      await db.exec(
        `update client set archived_at = null where id = '${CLIENT_B}'`
      )
    }
  })

  it("refuses a share with no client rather than reading the agency", async () => {
    await expect(
      loadSharedClientReport(
        sql,
        { organisationId: ORG, clientId: "" },
        "28d",
        NOW
      )
    ).rejects.toThrow(/needs its organisation and client/)
  })

  it("binds client A's id into every statement that reads reviews or metrics", async () => {
    const recorder = pgliteSql(db)
    await loadSharedClientReport(
      recorder.sql,
      { organisationId: ORG, clientId: CLIENT_A },
      "90d",
      NOW
    )
    const reads = recorder.executed.filter((statement) =>
      /from (review|performance_metric_daily|sync_checkpoint|external_location|location)\b/.test(
        statement.text
      )
    )
    expect(reads.length).toBeGreaterThan(5)
    for (const statement of reads) {
      expect(statement.params, statement.text).toContain(CLIENT_A)
      expect(statement.params).not.toContain(CLIENT_B)
    }
  })
})

describe("each narrowing holds on its own", () => {
  const overviewWindow = {
    from: "2026-08-23T12:00:00.000Z",
    to: NOW.toISOString(),
    granularity: "day" as const,
  }

  it("the share viewer alone (no clientId filter) sees only client A", async () => {
    const overview = await loadAnalyticsOverview(sql, shareA, overviewWindow)
    expect(
      (overview.summary as unknown as { reviewVolume: number }).reviewVolume
    ).toBe(2)
    expect(
      (overview.locations as unknown as { name: string }[]).map((l) => l.name)
    ).toEqual(["Old Crown, Sutton"])
    expect(overview.providerTotals.totalReviewCount).toBe(2)

    const presence = await loadPresenceReport(
      sql,
      shareA,
      { range: "28d" },
      NOW
    )
    expect(presence.locations.map((l) => l.name)).toEqual(["Old Crown, Sutton"])
    expect(presence.totals.CALL_CLICKS).toBe(3)
    expect(presence.unavailableReasons).toEqual([])
  })

  it("the clientId filter alone (an owner's session) sees only client A", async () => {
    const owner: ReportViewer = {
      role: "owner",
      userId: "00000000-0000-4000-8000-0000000000ff",
      organisationId: ORG,
    }
    const overview = await loadAnalyticsOverview(sql, owner, {
      ...overviewWindow,
      clientId: CLIENT_A,
    })
    expect(
      (overview.summary as unknown as { reviewVolume: number }).reviewVolume
    ).toBe(2)
    const presence = await loadPresenceReport(
      sql,
      owner,
      { range: "28d", clientId: CLIENT_A },
      NOW
    )
    expect(presence.totals.CALL_CLICKS).toBe(3)
  })

  it("a share viewer cannot be widened by asking for another client", async () => {
    // Even if a clientId for B reached the loader with A's share viewer, the
    // two narrowings intersect to nothing rather than to B.
    const overview = await loadAnalyticsOverview(sql, shareA, {
      ...overviewWindow,
      clientId: CLIENT_B,
    })
    expect(
      (overview.summary as unknown as { reviewVolume: number }).reviewVolume
    ).toBe(0)
    const presence = await loadPresenceReport(
      sql,
      shareA,
      { range: "28d", clientId: CLIENT_B },
      NOW
    )
    expect(presence.state).toBe("no_link")
    expect(presence.totals.CALL_CLICKS).toBe(0)
  })
})

describe("client share visibility (lib/server/permissions.ts)", () => {
  const fragmentSql = postgres("postgres://unit-test@127.0.0.1:1/never", {
    max: 1,
    fetch_types: false,
  }) as unknown as TransactionSql

  afterAll(async () => {
    await (fragmentSql as unknown as postgres.Sql).end({ timeout: 0 })
  })

  it("is the one client's locations, bound to the given column", () => {
    const fragment = visibilityPredicate(
      fragmentSql,
      { kind: "client_share", clientId: CLIENT_A },
      fragmentSql`r.location_id`
    )
    const { text, params } = render(
      fragment as unknown as Parameters<typeof render>[0]
    )
    expect(text).toBe(
      "exists ( select 1 from location visibility_share_l " +
        "where visibility_share_l.id = r.location_id " +
        "and visibility_share_l.client_id = $1 )"
    )
    expect(params).toEqual([CLIENT_A])
  })

  it("is equality with the one client for client visibility", () => {
    const fragment = clientVisibilityPredicate(
      fragmentSql,
      { kind: "client_share", clientId: CLIENT_A },
      fragmentSql`c.id`
    )
    expect(render(fragment as unknown as Parameters<typeof render>[0])).toEqual(
      { text: "(c.id = $1)", params: [CLIENT_A] }
    )
  })

  it("refuses an empty client id", () => {
    expect(() =>
      visibilityPredicate(
        fragmentSql,
        { kind: "client_share", clientId: "" },
        fragmentSql`r.location_id`
      )
    ).toThrow(/client id/)
  })
})
