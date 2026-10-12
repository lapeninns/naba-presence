import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const schedules = read("0079_post_publication_schedules.sql")
const quarantine = read("0240_post_schedule_quarantine.sql")
const strict = read("0241_post_schedule_strict_slot.sql")
const migration = read("0242_post_schedule_dispatch.sql")

const ORG = "00000000-0000-4000-8000-00000000000a"
const LOCATION = "00000000-0000-4000-8000-0000000000b1"
const UNLINKED = "00000000-0000-4000-8000-0000000000b2"
const USER = "00000000-0000-4000-8000-0000000000c1"
const CONNECTION = "00000000-0000-4000-8000-0000000000d1"
const EXTERNAL = "00000000-0000-4000-8000-0000000000e1"
const HASH = "a".repeat(64)

describe("0242 scheduled dispatch migration", () => {
  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0242_post_schedule_dispatch")
  })

  it("creates no work and grants only the sweep and claim functions", () => {
    expect(migration).not.toMatch(/insert into (job|post_publication)/)
    expect(migration).not.toMatch(/grant[^;]* on (table )?\w+ to/i)
    for (const fn of [
      "mark_missed_post_occurrences()",
      "settle_post_occurrences_from_receipts()",
      "claim_due_publication_schedules(integer, integer, integer)",
    ]) {
      expect(migration).toContain(`revoke all on function ${fn} from public`)
      expect(migration).toContain(
        `grant execute on function ${fn} to naba_app_runtime`
      )
    }
  })

  describe("against PGlite with live rows", () => {
    let db: PGlite
    const ids: Record<string, string> = {}
    const once = {
      frequency: "once",
      startDate: "2026-11-01",
      localTime: "09:00",
    }
    const daily = {
      frequency: "daily",
      startDate: "2026-11-01",
      localTime: "09:00",
      end: { type: "count", count: 2 },
    }

    async function schedule(
      rule: { frequency: string },
      status = "active",
      location = LOCATION,
      reason: string | null = null
    ): Promise<string> {
      const approved = status !== "awaiting_approval"
      const result = await db.query<{ id: string }>(
        `insert into post_publication_schedule
           (organisation_id, location_id, template, rule, timezone, payload_hash,
            status, status_reason, requested_by, approved_by, approved_revision,
            require_two_person_approval, offset_minutes)
         values ($1, $2, '{}', $3, 'Europe/London', $4, $5, $6, $7, $8, $9, false, $10)
         returning id`,
        [
          ORG,
          location,
          rule,
          HASH,
          status,
          reason,
          USER,
          approved ? USER : null,
          approved ? 1 : null,
          rule.frequency === "once" ? 0 : null,
        ]
      )
      return result.rows[0]!.id
    }
    /** An occurrence `minutesAgo` minutes ago (negative: in the future). */
    async function occurrence(
      scheduleId: string,
      minutesAgo: number,
      status = "scheduled",
      location = LOCATION
    ) {
      const result = await db.query<{ id: string }>(
        `insert into post_publication_occurrence
           (organisation_id, schedule_id, location_id, schedule_revision,
            intended_at, local_date, local_time, status)
         values ($1, $2, $3, 1, now() - make_interval(mins => $4), '2026-11-01', '09:00', $5)
         returning id`,
        [ORG, scheduleId, location, minutesAgo, status]
      )
      return result.rows[0]!.id
    }
    const scheduleState = async (id: string) =>
      (
        await db.query<{ status: string; status_reason: string | null }>(
          "select status, status_reason from post_publication_schedule where id = $1",
          [id]
        )
      ).rows[0]!
    const occurrenceState = async (id: string) =>
      (
        await db.query<{ status: string; status_reason: string | null }>(
          "select status, status_reason from post_publication_occurrence where id = $1",
          [id]
        )
      ).rows[0]!

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key, approval_required boolean not null default true);
        create table app_user (id uuid primary key);
        create table location (id uuid primary key);
        create table google_connection (id uuid primary key, status text not null default 'active', credential_generation integer not null default 1);
        create table external_location (id uuid primary key, google_connection_id uuid, google_location_name text);
        create table location_link (location_id uuid not null, external_location_id uuid not null, is_active boolean not null default true);
        create table gbp_local_post (
          id uuid primary key,
          organisation_id uuid not null,
          location_id uuid not null,
          status text not null,
          scheduled_publish_time timestamptz,
          recurrence jsonb
        );
        create table mutation_operation (
          id uuid primary key default gen_random_uuid(),
          organisation_id uuid not null,
          intent_id uuid not null,
          state text not null,
          unique (organisation_id, intent_id)
        );
        insert into organisation values ('${ORG}', false);
        insert into app_user values ('${USER}');
        insert into location values ('${LOCATION}'), ('${UNLINKED}');
        insert into google_connection values ('${CONNECTION}', 'active', 3);
        insert into external_location values ('${EXTERNAL}', '${CONNECTION}', 'locations/123');
        insert into location_link values ('${LOCATION}', '${EXTERNAL}', true);
      `)
      await db.exec(schedules)
      await db.exec(quarantine)
      await db.exec(strict)

      ids.active = await schedule(once)
      ids.activeRun = await occurrence(ids.active, -60)
      ids.unlinked = await schedule(once, "active", UNLINKED)
      await occurrence(ids.unlinked, -60, "scheduled", UNLINKED)
      ids.waiting = await schedule(once, "awaiting_approval")
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    it("pins a live approval to the current link and policy, and leaves an unlinked or waiting one unpinned", async () => {
      const target = async (id: string) =>
        (
          await db.query<Record<string, unknown>>(
            `select target_google_connection_id as connection, target_credential_generation as generation,
               target_google_location_name as name, approved_approval_required as policy,
               approved_security_version as security
             from post_publication_schedule where id = $1`,
            [id]
          )
        ).rows[0]!
      expect(await target(ids.active)).toEqual({
        connection: CONNECTION,
        generation: 3,
        name: "locations/123",
        policy: false,
        security: null,
      })
      expect(await target(ids.unlinked)).toMatchObject({
        connection: null,
        generation: null,
        name: null,
        policy: false,
      })
      expect(await target(ids.waiting)).toEqual({
        connection: null,
        generation: null,
        name: null,
        policy: null,
        security: null,
      })
    })

    it("runs again as a no-op on the rows it migrated", async () => {
      const before = await db.query(
        "select id, status, status_reason, target_google_connection_id, approved_approval_required from post_publication_schedule order by id"
      )
      await db.exec(migration)
      const after = await db.query(
        "select id, status, status_reason, target_google_connection_id, approved_approval_required from post_publication_schedule order by id"
      )
      expect(after.rows).toEqual(before.rows)
    })

    it("claims an occurrence only inside its window", async () => {
      const due = await schedule(once)
      await occurrence(due, 2)
      const late = await schedule(once)
      await occurrence(late, 6)
      const claimed = await db.query<{ schedule_id: string }>(
        "select schedule_id from claim_due_publication_schedules(50, 60, 50)"
      )
      const claimedIds = claimed.rows.map((row) => row.schedule_id)
      expect(claimedIds).toContain(due)
      expect(claimedIds).not.toContain(late)
      expect(claimedIds).not.toContain(ids.active)
    })

    it("records passed slots as missed, paused ones as paused_when_due, and sends one-time schedules to review", async () => {
      const paused = await schedule(once, "paused")
      const pausedRun = await occurrence(paused, 6)
      const late = await schedule(once)
      const lateRun = await occurrence(late, 30)
      const blocked = await schedule(
        once,
        "blocked",
        LOCATION,
        "feature_disabled"
      )
      const blockedRun = await occurrence(blocked, 10)
      const repeating = await schedule(daily)
      const repeatingRun = await occurrence(repeating, 10)
      const inWindow = await schedule(once)
      const inWindowRun = await occurrence(inWindow, 1)

      const missed = await db.query<{ occurrence_id: string; reason: string }>(
        "select occurrence_id, reason from mark_missed_post_occurrences()"
      )
      const reasons = Object.fromEntries(
        missed.rows.map((row) => [row.occurrence_id, row.reason])
      )
      expect(reasons[pausedRun]).toBe("paused_when_due")
      expect(reasons[lateRun]).toBe("outside_dispatch_window")
      expect(reasons[blockedRun]).toBe("outside_dispatch_window")
      expect(reasons[repeatingRun]).toBe("outside_dispatch_window")
      expect(reasons[inWindowRun]).toBeUndefined()

      expect(await scheduleState(paused)).toEqual({
        status: "needs_review",
        status_reason: "paused_when_due",
      })
      expect(await scheduleState(late)).toEqual({
        status: "needs_review",
        status_reason: "outside_dispatch_window",
      })
      expect(await scheduleState(blocked)).toEqual({
        status: "blocked",
        status_reason: "feature_disabled",
      })
      expect((await scheduleState(repeating)).status).toBe("completed")
      expect(await occurrenceState(inWindowRun)).toEqual({
        status: "scheduled",
        status_reason: null,
      })
      expect((await scheduleState(inWindow)).status).toBe("active")

      // Nothing left to mark: a second sweep is a no-op.
      const again = await db.query(
        "select * from mark_missed_post_occurrences()"
      )
      expect(again.rows).toHaveLength(0)
    })

    it("settles an unresolved occurrence from its receipt, never from a pending one, and unblocks the schedule", async () => {
      const intent = "00000000-0000-4000-8000-0000000000f1"
      const pendingIntent = "00000000-0000-4000-8000-0000000000f2"
      const failedIntent = "00000000-0000-4000-8000-0000000000f3"
      const landed = await schedule(
        once,
        "blocked",
        LOCATION,
        "prior_occurrence_unresolved"
      )
      const landedRun = await occurrence(landed, 30, "ambiguous")
      const pending = await schedule(
        once,
        "blocked",
        LOCATION,
        "prior_occurrence_unresolved"
      )
      const pendingRun = await occurrence(pending, 30, "ambiguous")
      const lost = await schedule(
        daily,
        "blocked",
        LOCATION,
        "prior_occurrence_unresolved"
      )
      const lostRun = await occurrence(lost, 30, "ambiguous")
      const nextRun = await occurrence(lost, -60 * 24)
      for (const [id, value] of [
        [landedRun, intent],
        [pendingRun, pendingIntent],
        [lostRun, failedIntent],
      ])
        await db.query(
          "update post_publication_occurrence set intent_id = $2 where id = $1",
          [id, value]
        )
      await db.query(
        `insert into mutation_operation (organisation_id, intent_id, state)
         values ($1, $2, 'confirmed_applied'), ($1, $3, 'uncertain'), ($1, $4, 'failed')`,
        [ORG, intent, pendingIntent, failedIntent]
      )
      const settled = await db.query<{ occurrence_id: string; status: string }>(
        "select occurrence_id, status from settle_post_occurrences_from_receipts()"
      )
      expect(
        Object.fromEntries(
          settled.rows.map((row) => [row.occurrence_id, row.status])
        )
      ).toEqual({ [landedRun]: "published", [lostRun]: "rejected" })
      expect(await occurrenceState(lostRun)).toEqual({
        status: "rejected",
        status_reason: "publish_failed",
      })
      expect(await occurrenceState(pendingRun)).toEqual({
        status: "ambiguous",
        status_reason: null,
      })
      expect(await scheduleState(landed)).toEqual({
        status: "completed",
        status_reason: null,
      })
      expect(await scheduleState(lost)).toEqual({
        status: "active",
        status_reason: null,
      })
      expect(await scheduleState(pending)).toEqual({
        status: "blocked",
        status_reason: "prior_occurrence_unresolved",
      })
      // Nothing was re-armed: the next run is the one that was waiting.
      expect((await occurrenceState(nextRun)).status).toBe("scheduled")
    })
  })
})
