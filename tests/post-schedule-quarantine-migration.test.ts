import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { SCHEDULE_STATUSES } from "@/lib/contracts/publication-schedules"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const schedules = read("0079_post_publication_schedules.sql")
const migration = read("0116_post_schedule_quarantine.sql")

const ORG = "00000000-0000-4000-8000-00000000000a"
const LOCATION = "00000000-0000-4000-8000-0000000000b1"
const USER = "00000000-0000-4000-8000-0000000000c1"
const HASH = "a".repeat(64)

describe("0116 post schedule quarantine migration", () => {
  it("allows every status the contract names", () => {
    for (const status of SCHEDULE_STATUSES)
      expect(migration).toContain(`'${status}'`)
  })

  it("isolates the legacy review table and grants no insert or delete", () => {
    expect(migration).toContain(
      "alter table gbp_local_post_legacy_schedule force row level security"
    )
    expect(migration).toMatch(
      /create policy tenant_isolation on gbp_local_post_legacy_schedule/
    )
    expect(migration).toMatch(
      /grant select on gbp_local_post_legacy_schedule to naba_app_runtime/
    )
    // Update only the review columns: never the post, location or values.
    expect(migration).toMatch(
      /grant update \(status, reviewed_by, reviewed_at\) on gbp_local_post_legacy_schedule to naba_app_runtime/
    )
    expect(migration).not.toMatch(
      /grant[^;(]*update on gbp_local_post_legacy_schedule/
    )
    expect(migration).not.toMatch(
      /grant[^;]*(insert|delete)[^;]*on gbp_local_post_legacy_schedule/
    )
    // No job, claim or occurrence is created for a legacy value.
    expect(migration).not.toMatch(/insert into (job|post_publication)/)
  })

  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0116_post_schedule_quarantine")
  })

  describe("against PGlite with live rows", () => {
    let db: PGlite

    async function schedule(
      rule: object,
      status: string,
      approved = false
    ): Promise<string> {
      const result = await db.query<{ id: string }>(
        `insert into post_publication_schedule
           (organisation_id, location_id, template, rule, timezone, payload_hash,
            status, requested_by, approved_by, approved_revision,
            require_two_person_approval)
         values ($1, $2, '{}', $3, 'Europe/London', $4, $5, $6, $7, $8, false)
         returning id`,
        [
          ORG,
          LOCATION,
          rule,
          HASH,
          status,
          USER,
          approved ? USER : null,
          approved ? 1 : null,
        ]
      )
      return result.rows[0]!.id
    }
    async function occurrence(scheduleId: string, status: string, at: string) {
      await db.query(
        `insert into post_publication_occurrence
           (organisation_id, schedule_id, location_id, schedule_revision,
            intended_at, local_date, local_time, status)
         values ($1, $2, $3, 1, $4::timestamptz, ($4::timestamptz at time zone 'UTC')::date, '09:00', $5)`,
        [ORG, scheduleId, LOCATION, at, status]
      )
    }
    const statusOf = async (id: string) =>
      (
        await db.query<{ status: string; status_reason: string | null }>(
          "select status, status_reason from post_publication_schedule where id = $1",
          [id]
        )
      ).rows[0]
    const occurrencesOf = async (id: string) =>
      (
        await db.query<{ status: string; status_reason: string | null }>(
          "select status, status_reason from post_publication_occurrence where schedule_id = $1 order by intended_at",
          [id]
        )
      ).rows

    const daily = {
      frequency: "daily",
      startDate: "2026-11-01",
      localTime: "09:00",
      end: { type: "count", count: 3 },
    }
    const once = {
      frequency: "once",
      startDate: "2026-11-01",
      localTime: "09:00",
    }
    const ids: Record<string, string> = {}

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location (id uuid primary key);
        create table gbp_local_post (
          id uuid primary key default gen_random_uuid(),
          organisation_id uuid not null references organisation(id),
          location_id uuid not null references location(id),
          status text not null,
          scheduled_publish_time timestamptz,
          recurrence jsonb
        );
        insert into organisation values ('${ORG}');
        insert into app_user values ('${USER}');
        insert into location values ('${LOCATION}');
      `)
      await db.exec(schedules)
      // Live rows as 0079 left them.
      ids.activeDaily = await schedule(daily, "active", true)
      await occurrence(ids.activeDaily, "published", "2026-10-01T08:00:00Z")
      await occurrence(ids.activeDaily, "publishing", "2026-10-02T08:00:00Z")
      await occurrence(ids.activeDaily, "scheduled", "2026-10-03T08:00:00Z")
      ids.pausedDaily = await schedule(daily, "paused", true)
      await occurrence(ids.pausedDaily, "scheduled", "2026-10-03T08:00:00Z")
      ids.awaitingDaily = await schedule(daily, "awaiting_approval")
      ids.completedDaily = await schedule(daily, "completed", true)
      ids.activeOnce = await schedule(once, "active", true)
      await occurrence(ids.activeOnce, "scheduled", "2026-11-01T09:00:00Z")
      await db.exec(`
        insert into gbp_local_post (organisation_id, location_id, status, scheduled_publish_time, recurrence) values
          ('${ORG}', '${LOCATION}', 'draft', '2026-12-01T10:00:00Z', null),
          ('${ORG}', '${LOCATION}', 'failed', null, '{"frequency":"WEEKLY"}'),
          ('${ORG}', '${LOCATION}', 'published', '2026-09-01T10:00:00Z', null),
          ('${ORG}', '${LOCATION}', 'deleted', '2026-09-01T10:00:00Z', null),
          ('${ORG}', '${LOCATION}', 'draft', null, 'null'),
          ('${ORG}', '${LOCATION}', 'draft', null, null);
      `)
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    it("quarantines repeating schedules that could still run and cancels their pending occurrences", async () => {
      for (const id of [ids.activeDaily, ids.pausedDaily, ids.awaitingDaily])
        expect(await statusOf(id)).toEqual({
          status: "needs_review",
          status_reason: "recurring_quarantined",
        })
      expect(await occurrencesOf(ids.activeDaily)).toEqual([
        { status: "published", status_reason: null },
        // In flight: left to settle from its own outcome.
        { status: "publishing", status_reason: null },
        { status: "cancelled", status_reason: "schedule_quarantined" },
      ])
      expect(await occurrencesOf(ids.pausedDaily)).toEqual([
        { status: "cancelled", status_reason: "schedule_quarantined" },
      ])
    })

    it("leaves one-time and finished schedules untouched", async () => {
      expect(await statusOf(ids.activeOnce)).toEqual({
        status: "active",
        status_reason: null,
      })
      expect(await occurrencesOf(ids.activeOnce)).toEqual([
        { status: "scheduled", status_reason: null },
      ])
      expect((await statusOf(ids.completedDaily)).status).toBe("completed")
    })

    it("copies only unpublished legacy per-post schedules for review", async () => {
      const rows = await db.query<{
        status: string
        scheduled_publish_time: Date | null
        recurrence: unknown
      }>(
        "select status, scheduled_publish_time, recurrence from gbp_local_post_legacy_schedule order by scheduled_publish_time nulls last"
      )
      expect(rows.rows).toEqual([
        {
          status: "needs_review",
          scheduled_publish_time: new Date("2026-12-01T10:00:00Z"),
          recurrence: null,
        },
        {
          status: "needs_review",
          scheduled_publish_time: null,
          recurrence: { frequency: "WEEKLY" },
        },
      ])
      await expect(
        db.query(
          "insert into gbp_local_post_legacy_schedule (organisation_id, location_id, post_id) select organisation_id, location_id, id from gbp_local_post where recurrence is null and scheduled_publish_time is null limit 1"
        )
      ).rejects.toThrow(/check constraint/)
    })

    it("accepts needs_review and still refuses an unknown status", async () => {
      await schedule(daily, "needs_review")
      await expect(schedule(daily, "quarantined")).rejects.toThrow(
        /post_publication_schedule_status_check/
      )
    })

    it("is a no-op when run again", async () => {
      const before = await db.query(
        "select id, status, status_reason, updated_at from post_publication_schedule order by id"
      )
      const occurrencesBefore = await db.query(
        "select id, status, finished_at from post_publication_occurrence order by id"
      )
      const legacyBefore = await db.query(
        "select * from gbp_local_post_legacy_schedule order by id"
      )
      await db.exec(migration)
      expect(
        (
          await db.query(
            "select id, status, status_reason, updated_at from post_publication_schedule order by id"
          )
        ).rows
      ).toEqual(before.rows)
      expect(
        (
          await db.query(
            "select id, status, finished_at from post_publication_occurrence order by id"
          )
        ).rows
      ).toEqual(occurrencesBefore.rows)
      expect(
        (
          await db.query(
            "select * from gbp_local_post_legacy_schedule order by id"
          )
        ).rows
      ).toEqual(legacyBefore.rows)
      const versions = await db.query<{ version: string }>(
        "select version from schema_migration where version = '0116_post_schedule_quarantine'"
      )
      expect(versions.rows).toHaveLength(1)
    })
  })
})
