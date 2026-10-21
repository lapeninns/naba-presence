import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const schedules = read("0079_post_publication_schedules.sql")
const quarantine = read("0116_post_schedule_quarantine.sql")
const strict = read("0117_post_schedule_strict_slot.sql")
const migration = read("0121_post_schedule_operations.sql")
const review = read("0122_post_schedule_operations_review.sql")

const ORG = "00000000-0000-4000-8000-00000000000a"
const OTHER = "00000000-0000-4000-8000-00000000000b"
const LOCATION = "00000000-0000-4000-8000-0000000000b1"
const OTHER_LOCATION = "00000000-0000-4000-8000-0000000000b2"
const USER = "00000000-0000-4000-8000-0000000000c1"
const HASH = "a".repeat(64)
const EARLIER_KINDS = [
  "stale_heartbeat",
  "google_quota_pressure",
  "tick_never_completed",
  "tick_lock_wedged",
  "tick_cycle_overdue",
  // 0098 (wave 3's retention cycle): 0121 keeps it in the union.
  "tick_cycle_failures",
]

describe("0121 scheduled post operations migration", () => {
  it("is listed, changes no rows and grants only its two functions", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0121_post_schedule_operations")
    expect(migration).not.toMatch(/\b(create|drop) table\b/i)
    // Outside the function bodies, the only row written is its own version.
    const statements = migration.replace(/\$\$[\s\S]*?\$\$/g, "")
    expect(statements).not.toMatch(
      /^\s*(insert into|update|delete from) (?!schema_migration)/im
    )
    expect(migration).not.toMatch(/grant[^;]* on (table )?\w+ to/i)
    for (const fn of [
      "post_schedule_health(integer, integer)",
      "purge_post_schedule_history(integer)",
    ]) {
      expect(migration).toContain(`revoke all on function ${fn} from public`)
      expect(migration).toContain(
        `grant execute on function ${fn} to naba_app_runtime`
      )
    }
    expect(migration).toContain(
      "insert into schema_migration (version) values ('0121_post_schedule_operations')"
    )
  })

  it("0122 is listed, changes no rows, drops the 500 cap and keeps the same grants", () => {
    expect(REQUIRED_MIGRATIONS).toContain(
      "0122_post_schedule_operations_review"
    )
    expect(review).not.toMatch(/\b(create|drop|alter) table\b/i)
    const statements = review.replace(/\$\$[\s\S]*?\$\$/g, "")
    expect(statements).not.toMatch(
      /^\s*(insert into|update|delete from) (?!schema_migration)/im
    )
    // The health function reports every organisation; only the purge
    // datasets' bounded runs take a limit.
    const health = review.slice(
      review.indexOf("create or replace function post_schedule_health"),
      review.indexOf("create or replace function purge_post_schedule_dataset")
    )
    expect(health).toContain("post_schedule_health")
    expect(health).not.toMatch(/\blimit\b/i)
    for (const fn of [
      "post_schedule_health(integer, integer)",
      "purge_post_schedule_history(integer)",
      "purge_post_schedule_dataset(text, integer, integer, boolean)",
    ]) {
      expect(review).toContain(`revoke all on function ${fn} from public`)
      expect(review).toContain(
        `grant execute on function ${fn} to naba_app_runtime`
      )
    }
  })

  describe("against PGlite", () => {
    let db: PGlite

    async function schedule(
      status: string,
      options: { org?: string; updatedDaysAgo?: number; lease?: string } = {}
    ): Promise<string> {
      const org = options.org ?? ORG
      const result = await db.query<{ id: string }>(
        `insert into post_publication_schedule
           (organisation_id, location_id, template, rule, timezone, payload_hash,
            status, requested_by, approved_by, approved_revision,
            require_two_person_approval, updated_at, claim_lease_expires_at)
         values ($1, $2, '{}', '{"frequency":"once"}', 'Europe/London', $3, $4, $5, $5, 1, false,
           now() - make_interval(days => $6), $7::timestamptz)
         returning id`,
        [
          org,
          org === ORG ? LOCATION : OTHER_LOCATION,
          HASH,
          status,
          USER,
          options.updatedDaysAgo ?? 0,
          options.lease ?? null,
        ]
      )
      return result.rows[0]!.id
    }
    /**
     * An occurrence due `minutesAgo` minutes ago (its deadline five minutes
     * later), started and finished as given.
     */
    async function occurrence(
      scheduleId: string,
      status: string,
      options: {
        org?: string
        minutesAgo?: number
        startedMinutesAgo?: number
        finishedDaysAgo?: number
      } = {}
    ) {
      const org = options.org ?? ORG
      const result = await db.query<{ id: string }>(
        `insert into post_publication_occurrence
           (organisation_id, schedule_id, location_id, schedule_revision,
            intended_at, local_date, local_time, status, started_at, finished_at)
         values ($1, $2, $3, 1, now() - make_interval(secs => $4::float8 * 60 + random()), '2026-11-01', '09:00', $5,
           case when $6::integer is null then null else now() - make_interval(mins => $6::integer) end,
           case when $7::integer is null then null else now() - make_interval(days => $7::integer) end)
         returning id`,
        [
          org,
          scheduleId,
          org === ORG ? LOCATION : OTHER_LOCATION,
          options.minutesAgo ?? 0,
          status,
          options.startedMinutesAgo ?? null,
          options.finishedDaysAgo ?? null,
        ]
      )
      return result.rows[0]!.id
    }
    const exists = async (table: string, id: string) =>
      (await db.query(`select 1 from ${table} where id = $1`, [id])).rows
        .length === 1
    const asTenant = (org: string | null) =>
      db.query("select set_config('app.organisation_id', $1, false)", [
        org ?? "",
      ])

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key, approval_required boolean not null default true);
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
        create table platform_incident (
          id uuid primary key default gen_random_uuid(),
          kind text not null,
          subject text not null,
          constraint platform_incident_kind_check check (kind in (${EARLIER_KINDS.map((kind) => `'${kind}'`).join(", ")}))
        );
        insert into organisation values ('${ORG}', false), ('${OTHER}', false);
        insert into app_user values ('${USER}');
        insert into location values ('${LOCATION}'), ('${OTHER_LOCATION}');
      `)
      await db.exec(schedules)
      await db.exec(quarantine)
      await db.exec(strict)
      await db.exec(migration)
      await db.exec(review)
    })

    afterAll(async () => {
      await db.close()
    })

    it("keeps every earlier platform incident kind and admits the two new ones", async () => {
      for (const kind of [
        ...EARLIER_KINDS,
        "scheduled_post_stuck",
        "scheduled_post_overdue",
      ])
        await db.query(
          "insert into platform_incident (kind, subject) values ($1, 'x')",
          [kind]
        )
      await expect(
        db.query(
          "insert into platform_incident (kind, subject) values ('something_else', 'x')"
        )
      ).rejects.toThrow(/platform_incident_kind_check/)
    })

    it("reports per organisation only publishes past their lease and slots a minute past their deadline", async () => {
      const a = await schedule("active")
      // Stuck: started 20 minutes ago, no lease.
      await occurrence(a, "publishing", {
        minutesAgo: 20,
        startedMinutesAgo: 20,
      })
      // Not stuck: started recently.
      await occurrence(a, "publishing", { minutesAgo: 2, startedMinutesAgo: 2 })
      // Not stuck: an old start, but its schedule still holds a live lease.
      // Every time here is the database's clock, as the function reads it.
      const {
        rows: [{ inAMinute }],
      } = await db.query<{ inAMinute: string }>(
        `select (now() + interval '1 minute')::text as "inAMinute"`
      )
      const leased = await schedule("active", { lease: inAMinute })
      await occurrence(leased, "publishing", {
        minutesAgo: 30,
        startedMinutesAgo: 30,
      })
      // Overdue: deadline seven minutes ago. Not overdue: deadline 30 s ago.
      await occurrence(a, "scheduled", { minutesAgo: 12 })
      await occurrence(a, "scheduled", { minutesAgo: 5.5 })
      // Past ones that already ended are not reported.
      await occurrence(a, "missed", { minutesAgo: 60 })
      const b = await schedule("active", { org: OTHER })
      await occurrence(b, "scheduled", { org: OTHER, minutesAgo: 30 })
      await occurrence(b, "scheduled", { org: OTHER, minutesAgo: 20 })

      const { rows } = await db.query<{
        organisation_id: string
        stuck_publishing: number
        oldest_started_at: Date | null
        overdue_scheduled: number
        oldest_deadline_at: Date | null
      }>("select * from post_schedule_health(600, 60)")
      expect(
        rows.map((row) => ({
          org: row.organisation_id,
          stuck: row.stuck_publishing,
          overdue: row.overdue_scheduled,
          hasStarted: row.oldest_started_at !== null,
          hasDeadline: row.oldest_deadline_at !== null,
        }))
      ).toEqual([
        { org: ORG, stuck: 1, overdue: 1, hasStarted: true, hasDeadline: true },
        {
          org: OTHER,
          stuck: 0,
          overdue: 2,
          hasStarted: false,
          hasDeadline: true,
        },
      ])
      // The stuck one is the 20-minute-old start.
      const {
        rows: [{ minutes }],
      } = await db.query<{ minutes: number }>(
        `select extract(epoch from now() - $1::timestamptz)::float8 / 60 as minutes`,
        [rows[0]!.oldest_started_at]
      )
      expect(minutes).toBeGreaterThan(19)
      expect(minutes).toBeLessThan(21)
      // The overdue slots move on, and the report clears.
      await db.exec(
        "update post_publication_occurrence set status = 'missed', finished_at = now() where status in ('scheduled', 'publishing')"
      )
      expect(
        (await db.query("select * from post_schedule_health(600, 60)")).rows
      ).toEqual([])
    })

    it("reports every affected organisation, not only the first 500 (0122)", async () => {
      await db.exec(
        "delete from post_publication_occurrence; delete from post_publication_schedule;"
      )
      // 520 organisations, each with one slot well past its deadline.
      await db.exec(`
        insert into organisation (id, approval_required)
          select gen_random_uuid(), false from generate_series(1, 520);
        insert into post_publication_schedule
          (organisation_id, location_id, template, rule, timezone, payload_hash,
           status, requested_by, approved_by, approved_revision, require_two_person_approval)
          select id, '${LOCATION}', '{}', '{"frequency":"once"}', 'Europe/London', '${HASH}',
            'active', '${USER}', '${USER}', 1, false
          from organisation where id not in ('${ORG}', '${OTHER}');
        insert into post_publication_occurrence
          (organisation_id, schedule_id, location_id, schedule_revision,
           intended_at, local_date, local_time, status)
          select s.organisation_id, s.id, s.location_id, 1,
            now() - interval '30 minutes', '2026-11-01', '09:00', 'scheduled'
          from post_publication_schedule s;
      `)
      const { rows } = await db.query<{ overdue_scheduled: number }>(
        "select * from post_schedule_health(600, 180)"
      )
      expect(rows).toHaveLength(520)
      expect(rows.every((row) => row.overdue_scheduled === 1)).toBe(true)
      await db.exec(
        `delete from post_publication_occurrence; delete from post_publication_schedule;
         delete from organisation where id not in ('${ORG}', '${OTHER}');`
      )
    })

    it("refuses to purge without a tenant or below 30 days", async () => {
      await asTenant(null)
      await expect(
        db.query("select * from purge_post_schedule_history(180)")
      ).rejects.toThrow(/needs a tenant/)
      await asTenant(ORG)
      await expect(
        db.query("select * from purge_post_schedule_history(29)")
      ).rejects.toThrow(/at least 30 days/)
    })

    it("purges only ended history past the period, in the caller's tenant", async () => {
      await db.exec(
        "delete from post_publication_occurrence; delete from post_publication_schedule;"
      )
      const repeating = await schedule("active")
      const oldPublished = await occurrence(repeating, "published", {
        finishedDaysAgo: 200,
      })
      const recentMissed = await occurrence(repeating, "missed", {
        finishedDaysAgo: 10,
      })
      const oldAmbiguous = await occurrence(repeating, "ambiguous", {
        finishedDaysAgo: 300,
      })
      // Ended long ago with nothing left: goes, with its aged occurrences.
      const oldCancelled = await schedule("cancelled", { updatedDaysAgo: 200 })
      const cascaded = await occurrence(oldCancelled, "cancelled", {
        finishedDaysAgo: 200,
      })
      // Ended long ago, but one occurrence ended recently: kept.
      const oldCompleted = await schedule("completed", { updatedDaysAgo: 200 })
      await occurrence(oldCompleted, "published", { finishedDaysAgo: 20 })
      // Ended recently: kept. In review however old: kept.
      const recentCancelled = await schedule("cancelled", {
        updatedDaysAgo: 10,
      })
      const oldReview = await schedule("needs_review", { updatedDaysAgo: 400 })
      // The occurrence a review names is kept with it, however old (0122):
      // the unverified publish the person must check on Google, and a
      // blocked schedule's missed slot.
      const reviewRun = await occurrence(oldReview, "cancelled", {
        finishedDaysAgo: 400,
      })
      await db.query(
        "update post_publication_occurrence set status_reason = 'outcome_unverified' where id = $1",
        [reviewRun]
      )
      const oldBlocked = await schedule("blocked", { updatedDaysAgo: 400 })
      const blockedRun = await occurrence(oldBlocked, "missed", {
        finishedDaysAgo: 400,
      })
      // Another tenant's aged history is not this call's to purge.
      const foreign = await schedule("cancelled", {
        org: OTHER,
        updatedDaysAgo: 400,
      })
      const foreignRun = await occurrence(foreign, "published", {
        org: OTHER,
        finishedDaysAgo: 400,
      })

      const post = (id: string) =>
        db.query(
          `insert into gbp_local_post (id, organisation_id, location_id, status) values ($1, $2, $3, 'draft')`,
          [id, ORG, LOCATION]
        )
      const legacy = async (
        postId: string,
        status: string,
        reviewedDaysAgo: number | null
      ) => {
        await post(postId)
        const result = await db.query<{ id: string }>(
          `insert into gbp_local_post_legacy_schedule
             (organisation_id, location_id, post_id, scheduled_publish_time, status, reviewed_at)
           values ($1, $2, $3, now(), $4,
             case when $5::integer is null then null else now() - make_interval(days => $5::integer) end)
           returning id`,
          [ORG, LOCATION, postId, status, reviewedDaysAgo]
        )
        return result.rows[0]!.id
      }
      const oldDismissed = await legacy(
        "00000000-0000-4000-8000-0000000000f1",
        "dismissed",
        200
      )
      const recentDismissed = await legacy(
        "00000000-0000-4000-8000-0000000000f2",
        "dismissed",
        5
      )
      const unreviewed = await legacy(
        "00000000-0000-4000-8000-0000000000f3",
        "needs_review",
        null
      )

      await asTenant(ORG)
      const { rows } = await db.query<{
        occurrences: number
        schedules: number
        legacy_schedules: number
      }>("select * from purge_post_schedule_history(180)")
      expect(rows).toEqual([
        { occurrences: 2, schedules: 1, legacy_schedules: 1 },
      ])

      const occ = "post_publication_occurrence"
      const sch = "post_publication_schedule"
      const leg = "gbp_local_post_legacy_schedule"
      expect(await exists(occ, oldPublished)).toBe(false)
      expect(await exists(occ, cascaded)).toBe(false)
      expect(await exists(sch, oldCancelled)).toBe(false)
      expect(await exists(leg, oldDismissed)).toBe(false)
      for (const id of [
        recentMissed,
        oldAmbiguous,
        foreignRun,
        reviewRun,
        blockedRun,
      ])
        expect(await exists(occ, id), id).toBe(true)
      for (const id of [
        repeating,
        oldCompleted,
        recentCancelled,
        oldReview,
        oldBlocked,
        foreign,
      ])
        expect(await exists(sch, id), id).toBe(true)
      for (const id of [recentDismissed, unreviewed])
        expect(await exists(leg, id), id).toBe(true)

      // A second run finds nothing more.
      expect(
        (await db.query("select * from purge_post_schedule_history(180)")).rows
      ).toEqual([{ occurrences: 0, schedules: 0, legacy_schedules: 0 }])
    })

    it("runs each dataset bounded, and previews it without changing anything", async () => {
      await db.exec(
        "delete from post_publication_occurrence; delete from post_publication_schedule; delete from gbp_local_post_legacy_schedule;"
      )
      const ended = await schedule("active")
      const aged: string[] = []
      for (let index = 0; index < 3; index += 1)
        aged.push(
          await occurrence(ended, "published", { finishedDaysAgo: 200 })
        )
      const cancelled = await schedule("cancelled", { updatedDaysAgo: 200 })
      const foreign = await schedule("cancelled", {
        org: OTHER,
        updatedDaysAgo: 400,
      })
      await asTenant(ORG)
      const run = async (dataset: string, limit: number | null, dryRun: boolean) =>
        (
          await db.query<{ count: number }>(
            "select purge_post_schedule_dataset($1, 180, $2, $3) as count",
            [dataset, limit, dryRun]
          )
        ).rows[0]!.count
      // The dry run counts what a run would change, and changes nothing.
      expect(await run("occurrences", null, true)).toBe(3)
      expect(await run("schedules", null, true)).toBe(1)
      expect(await run("legacy_schedules", null, true)).toBe(0)
      for (const id of aged)
        expect(await exists("post_publication_occurrence", id)).toBe(true)
      // A bounded run changes at most its limit; the next one carries on.
      expect(await run("occurrences", 2, false)).toBe(2)
      expect(await run("occurrences", 2, true)).toBe(1)
      expect(await run("occurrences", 2, false)).toBe(1)
      expect(await run("occurrences", 2, false)).toBe(0)
      expect(await run("schedules", 1, false)).toBe(1)
      expect(await exists("post_publication_schedule", cancelled)).toBe(false)
      // Only the caller's tenant.
      expect(await exists("post_publication_schedule", foreign)).toBe(true)
      await expect(run("everything", 1, false)).rejects.toThrow(
        /unknown dataset/
      )
      await expect(run("occurrences", 0, false)).rejects.toThrow(
        /positive limit/
      )
      await asTenant(null)
      await expect(run("occurrences", 1, true)).rejects.toThrow(
        /needs a tenant/
      )
      await asTenant(ORG)
      await expect(
        db.query("select purge_post_schedule_dataset('occurrences', 29)")
      ).rejects.toThrow(/at least 30 days/)
    })

    it("is safe to run again", async () => {
      await db.exec(migration)
      await db.exec(review)
      expect(
        (
          await db.query(
            "select version from schema_migration where version = '0122_post_schedule_operations_review'"
          )
        ).rows
      ).toHaveLength(1)
      const { rows } = await db.query<{ version: string }>(
        "select version from schema_migration where version = '0121_post_schedule_operations'"
      )
      expect(rows).toHaveLength(1)
    })
  })
})
