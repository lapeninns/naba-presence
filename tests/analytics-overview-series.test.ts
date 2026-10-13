import { PGlite } from "@electric-sql/pglite"
import type { TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import type { ReportViewer } from "@/lib/server/permissions"

import { pgliteSql } from "./helpers/pglite-sql"

// The reply charts are drawn from `series`, the tiles from `summary`. The
// series buckets used to be stepped in the database session's zone (UTC)
// while each review was bucketed on the organisation's wall clock, so after
// a clock change, and for every month bucket outside UTC, the two never met
// and the charts read "No reviews in this window" beside tiles counting
// reviews. These run the real loader against PostgreSQL (PGlite) and hold
// the two to the same total.

const ORG_NZ = "00000000-0000-4000-8000-0000000000a1"
const ORG_UK = "00000000-0000-4000-8000-0000000000b1"
const CLIENT_NZ = "aaaaaaaa-0000-4000-8000-0000000000a1"
const CLIENT_UK = "bbbbbbbb-0000-4000-8000-0000000000b1"
const LOC_NZ = "aaaaaaaa-1111-4000-8000-0000000000a1"
const LOC_UK = "bbbbbbbb-1111-4000-8000-0000000000b1"

const viewer = (organisationId: string, clientId: string): ReportViewer => ({
  kind: "client_share",
  organisationId,
  clientId,
})

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
      name text not null, archived_at timestamptz
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
      create_time timestamptz not null, provider_deleted_at timestamptz
    );
    create table review_reply (
      id uuid primary key default gen_random_uuid(),
      review_id uuid not null, publish_status text,
      first_published_at timestamptz, google_reply_updated_at timestamptz
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

    insert into organisation (id, name, default_timezone) values
      ('${ORG_NZ}', 'Harbour Agency', 'Pacific/Auckland'),
      ('${ORG_UK}', 'Thames Agency', 'Europe/London');
    insert into client (id, organisation_id, name) values
      ('${CLIENT_NZ}', '${ORG_NZ}', 'Ponsonby Group'),
      ('${CLIENT_UK}', '${ORG_UK}', 'Old Crown Group');
    insert into location (id, organisation_id, client_id, name) values
      ('${LOC_NZ}', '${ORG_NZ}', '${CLIENT_NZ}', 'Ponsonby'),
      ('${LOC_UK}', '${ORG_UK}', '${CLIENT_UK}', 'Old Crown');

    -- NZ daylight saving began on 27 Sep 2026: one review either side.
    insert into review (location_id, star_rating, create_time) values
      ('${LOC_NZ}', 5, '2026-09-20T03:00:00Z'),
      ('${LOC_NZ}', 4, '2026-10-05T03:00:00Z');
    -- London summer time: a month bucket starts at 23:00 UTC.
    insert into review (location_id, star_rating, create_time) values
      ('${LOC_UK}', 3, '2026-07-05T03:00:00Z');
  `)
  sql = pgliteSql(db).sql
})

afterAll(async () => {
  await db.close()
})

function seriesTotal(series: unknown) {
  return (series as Array<{ reviewCount: number }>).reduce(
    (sum, point) => sum + point.reviewCount,
    0
  )
}

describe("loadAnalyticsOverview series buckets", () => {
  it("counts every review in daily buckets across a clock change", async () => {
    const overview = await loadAnalyticsOverview(
      sql,
      viewer(ORG_NZ, CLIENT_NZ),
      {
        from: "2026-09-15T00:00:00.000Z",
        to: "2026-10-13T00:00:00.000Z",
        granularity: "day",
        clientId: CLIENT_NZ,
      }
    )
    expect(overview.summary.reviewVolume).toBe(2)
    expect(seriesTotal(overview.series)).toBe(2)
    // One bucket per local calendar day, 15 Sep to 13 Oct inclusive
    // (the window starts at 12:00 on 15 Sep in Auckland).
    expect(overview.series).toHaveLength(29)
  })

  it("counts every review in month buckets outside UTC", async () => {
    const overview = await loadAnalyticsOverview(
      sql,
      viewer(ORG_UK, CLIENT_UK),
      {
        from: "2026-01-15T00:00:00.000Z",
        to: "2026-10-13T00:00:00.000Z",
        granularity: "month",
        clientId: CLIENT_UK,
      }
    )
    expect(overview.summary.reviewVolume).toBe(1)
    expect(seriesTotal(overview.series)).toBe(1)
    expect(overview.series).toHaveLength(10)
  })

  it("counts every review in week buckets across a clock change", async () => {
    const overview = await loadAnalyticsOverview(
      sql,
      viewer(ORG_NZ, CLIENT_NZ),
      {
        from: "2026-07-15T00:00:00.000Z",
        to: "2026-10-13T00:00:00.000Z",
        granularity: "week",
        clientId: CLIENT_NZ,
      }
    )
    expect(seriesTotal(overview.series)).toBe(overview.summary.reviewVolume)
  })
})
