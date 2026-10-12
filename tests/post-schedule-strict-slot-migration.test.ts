import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const schedules = read("0079_post_publication_schedules.sql")
const quarantine = read("0116_post_schedule_quarantine.sql")
const migration = read("0117_post_schedule_strict_slot.sql")

const ORG = "00000000-0000-4000-8000-00000000000a"
const LOCATION = "00000000-0000-4000-8000-0000000000b1"
const USER = "00000000-0000-4000-8000-0000000000c1"
const HASH = "a".repeat(64)

describe("0117 strict one-time slot migration", () => {
  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0117_post_schedule_strict_slot")
  })

  it("grants nothing new and creates no work", () => {
    expect(migration).not.toMatch(/\bgrant\b/i)
    expect(migration).not.toMatch(/insert into (job|post_publication)/)
  })

  describe("against PGlite with live 0079 rows", () => {
    let db: PGlite
    const ids: Record<string, string> = {}

    async function schedule(rule: object, status = "active"): Promise<string> {
      const result = await db.query<{ id: string }>(
        `insert into post_publication_schedule
           (organisation_id, location_id, template, rule, timezone, payload_hash,
            status, requested_by, approved_by, approved_revision,
            require_two_person_approval)
         values ($1, $2, '{}', $3, 'Europe/London', $4, $6, $5, $5, 1, false)
         returning id`,
        [ORG, LOCATION, rule, HASH, USER, status]
      )
      return result.rows[0]!.id
    }
    async function occurrence(
      scheduleId: string,
      at: string,
      localDate: string,
      localTime: string,
      adjustment = "none"
    ) {
      const result = await db.query<{ id: string }>(
        `insert into post_publication_occurrence
           (organisation_id, schedule_id, location_id, schedule_revision,
            intended_at, local_date, local_time, adjustment)
         values ($1, $2, $3, 1, $4::timestamptz, $5::date, $6, $7)
         returning id`,
        [ORG, scheduleId, LOCATION, at, localDate, localTime, adjustment]
      )
      return result.rows[0]!.id
    }
    const offsetOf = async (id: string) =>
      (
        await db.query<{ offset_minutes: number | null }>(
          "select offset_minutes from post_publication_schedule where id = $1",
          [id]
        )
      ).rows[0]!.offset_minutes
    const deadlineOf = async (id: string) =>
      (
        await db.query<{ intended_at: Date; deadline_at: Date }>(
          "select intended_at, deadline_at from post_publication_occurrence where id = $1",
          [id]
        )
      ).rows[0]!

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location (id uuid primary key);
        create table gbp_local_post (
          id uuid primary key,
          organisation_id uuid not null,
          location_id uuid not null,
          status text not null,
          scheduled_publish_time timestamptz,
          recurrence jsonb
        );
        insert into organisation values ('${ORG}');
        insert into app_user values ('${USER}');
        insert into location values ('${LOCATION}');
      `)
      await db.exec(schedules)
      await db.exec(quarantine)
      const once = (startDate: string, localTime: string) => ({
        frequency: "once",
        startDate,
        localTime,
      })
      // Summer time: 09:00 BST is 08:00 UTC, so +60.
      ids.summer = await schedule(once("2026-10-20", "09:00"))
      ids.summerOccurrence = await occurrence(
        ids.summer,
        "2026-10-20T08:00:00Z",
        "2026-10-20",
        "09:00"
      )
      // Winter: 09:00 GMT, so 0.
      ids.winter = await schedule(once("2026-11-20", "09:00"))
      await occurrence(
        ids.winter,
        "2026-11-20T09:00:00Z",
        "2026-11-20",
        "09:00"
      )
      // Approved under the old lenient rule: the earlier of a repeated time.
      ids.repeated = await schedule(once("2026-10-25", "01:30"))
      ids.repeatedOccurrence = await occurrence(
        ids.repeated,
        "2026-10-25T00:30:00Z",
        "2026-10-25",
        "01:30",
        "earlier_of_repeated"
      )
      // Moved forward out of a spring gap, then paused.
      ids.moved = await schedule(once("2027-03-28", "01:30"), "paused")
      ids.movedOccurrence = await occurrence(
        ids.moved,
        "2027-03-28T01:00:00Z",
        "2027-03-28",
        "01:30",
        "moved_forward"
      )
      ids.waiting = await schedule(
        once("2026-11-02", "09:00"),
        "awaiting_approval"
      )
      // An unresolved earlier run keeps its own reason.
      ids.blocked = await schedule(once("2026-10-25", "01:15"), "blocked")
      ids.daily = await schedule({
        frequency: "daily",
        startDate: "2026-11-01",
        localTime: "09:00",
        end: { type: "count", count: 2 },
      })
      await occurrence(ids.daily, "2026-11-01T09:00:00Z", "2026-11-01", "09:00")
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    it("backfills a one-time schedule's offset only from an unadjusted occurrence", async () => {
      expect(await offsetOf(ids.summer)).toBe(60)
      expect(await offsetOf(ids.winter)).toBe(0)
      expect(await offsetOf(ids.repeated)).toBeNull()
      expect(await offsetOf(ids.waiting)).toBeNull()
      expect(await offsetOf(ids.daily)).toBeNull()
    })

    it("keeps the stored payload hash of a backfilled schedule", async () => {
      const row = (
        await db.query<{ payload_hash: string; status: string }>(
          "select payload_hash, status from post_publication_schedule where id = $1",
          [ids.summer]
        )
      ).rows[0]!
      expect(row).toEqual({ payload_hash: HASH, status: "active" })
    })

    it("sends live one-time schedules a clock change moved to review, and cancels their waiting run", async () => {
      const state = async (id: string) =>
        (
          await db.query<{ status: string; status_reason: string | null }>(
            "select status, status_reason from post_publication_schedule where id = $1",
            [id]
          )
        ).rows[0]!
      const run = async (id: string) =>
        (
          await db.query<{ status: string; status_reason: string | null }>(
            "select status, status_reason from post_publication_occurrence where id = $1",
            [id]
          )
        ).rows[0]!
      for (const id of [ids.repeated, ids.moved])
        expect(await state(id)).toEqual({
          status: "needs_review",
          status_reason: "slot_needs_new_time",
        })
      for (const id of [ids.repeatedOccurrence, ids.movedOccurrence])
        expect(await run(id)).toEqual({
          status: "cancelled",
          status_reason: "schedule_quarantined",
        })
      expect(await state(ids.summer)).toEqual({
        status: "active",
        status_reason: null,
      })
      expect(await run(ids.summerOccurrence)).toEqual({
        status: "scheduled",
        status_reason: null,
      })
      expect((await state(ids.waiting)).status).toBe("awaiting_approval")
      expect((await state(ids.blocked)).status).toBe("blocked")
    })

    it("backfills every occurrence's deadline as intended + 5 minutes", async () => {
      const rows = (
        await db.query<{ late: number; missing: number }>(
          `select count(*) filter (where deadline_at <> intended_at + interval '5 minutes')::int as late,
             count(*) filter (where deadline_at is null)::int as missing
           from post_publication_occurrence`
        )
      ).rows[0]!
      expect(rows).toEqual({ late: 0, missing: 0 })
    })

    it("defaults the deadline for writers that do not name it, and moves it with the intended instant", async () => {
      const id = await occurrence(
        ids.daily,
        "2026-11-02T09:00:00Z",
        "2026-11-02",
        "09:00"
      )
      expect((await deadlineOf(id)).deadline_at).toEqual(
        new Date("2026-11-02T09:05:00Z")
      )
      await db.query(
        "update post_publication_occurrence set intended_at = '2026-11-02T10:00:00Z' where id = $1",
        [id]
      )
      expect((await deadlineOf(id)).deadline_at).toEqual(
        new Date("2026-11-02T10:05:00Z")
      )
      // An explicit deadline is kept.
      await db.query(
        "update post_publication_occurrence set intended_at = '2026-11-02T11:00:00Z', deadline_at = '2026-11-02T11:01:00Z' where id = $1",
        [id]
      )
      expect((await deadlineOf(id)).deadline_at).toEqual(
        new Date("2026-11-02T11:01:00Z")
      )
    })

    it("refuses a deadline that is not after the intended instant and an impossible offset", async () => {
      await expect(
        db.query(
          "update post_publication_occurrence set deadline_at = intended_at where id = $1",
          [ids.summerOccurrence]
        )
      ).rejects.toThrow(/deadline_check/)
      await expect(
        db.query(
          "update post_publication_schedule set offset_minutes = 900 where id = $1",
          [ids.summer]
        )
      ).rejects.toThrow(/offset_minutes_check/)
    })

    it("is a no-op when run again", async () => {
      const before = await db.query(
        "select id, offset_minutes, status, status_reason from post_publication_schedule order by id"
      )
      const deadlines = await db.query(
        "select id, deadline_at, status, status_reason from post_publication_occurrence order by id"
      )
      await db.exec(migration)
      expect(
        (
          await db.query(
            "select id, offset_minutes, status, status_reason from post_publication_schedule order by id"
          )
        ).rows
      ).toEqual(before.rows)
      expect(
        (
          await db.query(
            "select id, deadline_at, status, status_reason from post_publication_occurrence order by id"
          )
        ).rows
      ).toEqual(deadlines.rows)
      expect(
        (
          await db.query<{ version: string }>(
            "select version from schema_migration where version = '0117_post_schedule_strict_slot'"
          )
        ).rows
      ).toHaveLength(1)
    })
  })
})
