import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

/**
 * The contract every `claim_due_jobs` rewrite must keep: it is replaced
 * whole (0034 explains why), so a rewrite that drops or edits an earlier
 * arm silently stops that kind of work. The latest definition must contain
 * every arm and claim of the one it replaces, verbatim up to whitespace.
 */
const read = (file: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8")

const previous = read("0048_fleet_queue.sql")
const latest = read("0092_mutation_recovery_jobs.sql")
const priority = read("0147_job_claim_priority.sql")

const squash = (text: string) => text.replace(/\s+/g, " ").trim()

/** The `due` CTE's union arms. */
function dueArms(sql: string): string[] {
  const start = sql.indexOf("with due as (")
  const end = sql.indexOf("candidate as (", start)
  expect(start, "due CTE").toBeGreaterThan(-1)
  return sql
    .slice(start + "with due as (".length, end)
    .split(/\bunion all\b/)
    .map((arm) => squash(arm.replace(/\),\s*$/, "")))
    .filter(Boolean)
}

/** Every `claim_* as ( ... )` CTE, as its full text. */
function claims(sql: string): Map<string, string> {
  const found = new Map<string, string>()
  const pattern = /(claim_[a-z_]+) as \(/g
  for (const match of sql.matchAll(pattern)) {
    let depth = 0
    let index = (match.index ?? 0) + match[0].length - 1
    const begin = index
    for (; index < sql.length; index += 1) {
      if (sql[index] === "(") depth += 1
      if (sql[index] === ")") depth -= 1
      if (depth === 0) break
    }
    found.set(match[1], squash(sql.slice(begin, index + 1)))
  }
  return found
}

describe("claim_due_jobs contract (0048 -> 0092)", () => {
  it("compares the latest definitions in the migration history", () => {
    // A later migration that rewrites claim_due_jobs (origin/main's 0079
    // and 0080 add their own claim functions instead) must be added here,
    // and keep every arm of the one it replaces.
    const defining = readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) =>
        /create (or replace )?function claim_due_jobs\s*\(/i.test(read(file))
      )
    expect(defining.slice(-3)).toEqual([
      "0048_fleet_queue.sql",
      "0092_mutation_recovery_jobs.sql",
      "0147_job_claim_priority.sql",
    ])
  })

  it("keeps every 0048 due arm verbatim", () => {
    const arms = dueArms(previous)
    expect(arms).toHaveLength(6)
    const body = squash(latest)
    for (const arm of arms) expect(body).toContain(arm)
  })

  it("keeps every 0048 claim and returns all of them", () => {
    const before = claims(previous)
    const after = claims(latest)
    expect([...before.keys()]).toEqual([
      "claim_dead",
      "claim_webhook",
      "claim_checkpoint",
      "claim_recover",
      "claim_retry",
      "claim_recurring",
    ])
    for (const [name, text] of before) expect(after.get(name)).toBe(text)
    for (const name of after.keys()) {
      expect(latest).toMatch(new RegExp(`select \\* from ${name}\\b`))
    }
  })

  it("adds the mutation_recover arm with its ceiling, lease and due time", () => {
    const arm = dueArms(latest).find((text) =>
      text.includes("'mutation_recover'")
    )
    expect(arm).toBeDefined()
    expect(arm).toContain("from mutation_operation m")
    expect(arm).toContain("m.state = 'uncertain'")
    expect(arm).toContain("m.recovery_attempts < 8")
    expect(arm).toContain("m.next_recovery_at <= v_now")
    expect(arm).toContain(
      "coalesce(m.lease_expires_at, '-infinity'::timestamptz) <= v_now"
    )
    expect(claims(latest).get("claim_mutation_recover")).toContain(
      "next_recovery_at = v_lease"
    )
  })

  it("re-issues the grants and is in the manifest", () => {
    expect(latest).toMatch(
      /grant execute on function claim_due_jobs\(integer, integer, integer, text\[\]\)\s+to naba_app_runtime/
    )
    expect(latest).toMatch(
      /grant execute on function release_job_lease\(text, uuid, uuid\)\s+to naba_app_runtime/
    )
    expect(REQUIRED_MIGRATIONS).toContain("0092_mutation_recovery_jobs")
  })

  describe("against PGlite", () => {
    let db: PGlite
    const ORG = "00000000-0000-4000-8000-00000000000a"
    const CONNECTION = "00000000-0000-4000-8000-0000000000c1"
    const EXTERNAL = "00000000-0000-4000-8000-0000000000e1"
    const id = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location (id uuid primary key);
        create table google_connection (id uuid primary key, status text);
        create table external_location (id uuid primary key, google_connection_id uuid);
        create table location_link (external_location_id uuid, is_active boolean);
        create table connection_task (google_connection_id uuid, task_type text, status text);
        create table notification_incident (kind text);
        create table processed_webhook_event (
          id uuid primary key, organisation_id uuid, external_location_id uuid,
          status text, retry_count integer default 0, claim_count integer default 0,
          next_attempt_at timestamptz, processed_at timestamptz,
          lease_expires_at timestamptz
        );
        create table sync_checkpoint (
          id uuid primary key, organisation_id uuid, external_location_id uuid,
          sync_type text, status text, next_attempt_at timestamptz,
          started_at timestamptz, lease_expires_at timestamptz,
          attempt_count integer default 0, dead_lettered_at timestamptz,
          scheduled_for timestamptz
        );
        create table publish_attempt (
          id uuid primary key, organisation_id uuid, status text,
          recovery_attempts integer default 0, attempt_no integer default 1,
          next_attempt_at timestamptz, started_at timestamptz default now(),
          lease_expires_at timestamptz
        );
        insert into organisation values ('${ORG}');
        insert into google_connection values ('${CONNECTION}', 'active');
        insert into external_location values ('${EXTERNAL}', '${CONNECTION}');
        insert into location_link values ('${EXTERNAL}', true);
      `)
      await db.exec(read("0086_mutation_operation.sql"))
      await db.exec(latest)
      const past = "now() - interval '1 minute'"
      await db.exec(`
        insert into processed_webhook_event (id, organisation_id, status, retry_count, next_attempt_at)
        values ('${id(1)}', '${ORG}', 'failed', 5, ${past}),
               ('${id(2)}', '${ORG}', 'failed', 0, ${past});
        insert into sync_checkpoint (id, organisation_id, external_location_id, sync_type, status, next_attempt_at)
        values ('${id(3)}', '${ORG}', '${EXTERNAL}', 'backfill', 'pending', ${past}),
               ('${id(6)}', '${ORG}', '${EXTERNAL}', 'reconcile', 'succeeded', ${past});
        insert into publish_attempt (id, organisation_id, status, next_attempt_at)
        values ('${id(4)}', '${ORG}', 'ambiguous', null),
               ('${id(5)}', '${ORG}', 'retryable', ${past});
        insert into mutation_operation
          (id, organisation_id, intent_id, surface, action, payload_hash, state,
           recovery_attempts, next_recovery_at)
        values
          ('${id(7)}', '${ORG}', '${id(70)}', 'hours', 'publish', '${"a".repeat(64)}', 'uncertain', 0, ${past}),
          -- given up on: uncertain with no recovery time
          ('${id(8)}', '${ORG}', '${id(80)}', 'hours', 'publish', '${"a".repeat(64)}', 'uncertain', 0, null),
          -- at the ceiling
          ('${id(9)}', '${ORG}', '${id(90)}', 'hours', 'publish', '${"a".repeat(64)}', 'uncertain', 8, ${past}),
          -- settled
          ('${id(10)}', '${ORG}', '${id(100)}', 'hours', 'publish', '${"a".repeat(64)}', 'confirmed_applied', 0, ${past});
      `)
    })

    afterAll(async () => {
      await db.close()
    })

    const claim = async (kinds: string[] | null = null) =>
      (
        await db.query<{ kind: string; job_id: string; retry_count: number }>(
          `select kind, job_id::text, retry_count
             from claim_due_jobs(50, 60, 50, $1::text[])`,
          [kinds]
        )
      ).rows

    it("claims every kind, the new one included, under one call", async () => {
      const rows = await claim()
      expect(rows.map((row) => row.kind).sort()).toEqual(
        [
          "checkpoint",
          "mutation_recover",
          "reconcile",
          "recover",
          "retry",
          "webhook",
          "webhook_dead",
        ].sort()
      )
      expect(rows.find((row) => row.kind === "mutation_recover")?.job_id).toBe(
        id(7)
      )
    })

    it("leases the receipt and pushes its due time to the lease end", async () => {
      const {
        rows: [row],
      } = await db.query<{ leased: boolean; due: boolean }>(
        `select lease_expires_at > now() as leased,
                next_recovery_at = lease_expires_at as due
           from mutation_operation where id = $1`,
        [id(7)]
      )
      expect(row).toEqual({ leased: true, due: true })
      expect(await claim(["mutation_recover"])).toEqual([])
    })

    it("releases the lease on mutation_operation", async () => {
      await db.query(`select release_job_lease('mutation_recover', $1, $2)`, [
        ORG,
        id(7),
      ])
      const {
        rows: [row],
      } = await db.query<{ lease: string | null }>(
        `select lease_expires_at as lease from mutation_operation where id = $1`,
        [id(7)]
      )
      expect(row.lease).toBeNull()
    })

    it("filters by kind", async () => {
      await db.exec(
        `update mutation_operation set next_recovery_at = now() - interval '1 minute' where id = '${id(7)}'`
      )
      expect((await claim(["retry"])).map((row) => row.kind)).toEqual([])
      expect(
        (await claim(["mutation_recover"])).map((row) => row.kind)
      ).toEqual(["mutation_recover"])
    })
  })
})

describe("claim_due_jobs contract (0092 -> 0147)", () => {
  it("keeps every 0092 due arm verbatim", () => {
    const arms = dueArms(latest)
    expect(arms).toHaveLength(7)
    expect(dueArms(priority)).toEqual(arms)
  })

  it("keeps every 0092 claim verbatim and returns all of them", () => {
    const before = claims(latest)
    const after = claims(priority)
    expect([...after.keys()]).toEqual([...before.keys()])
    for (const [name, text] of before) expect(after.get(name)).toBe(text)
    for (const name of after.keys()) {
      expect(priority).toMatch(new RegExp(`select \\* from ${name}\\b`))
    }
  })

  it("ranks by kind before due order, inside the per-organisation cap and across the batch", () => {
    const candidate = squash(
      priority.slice(
        priority.indexOf("candidate as ("),
        priority.indexOf("claim_dead as (")
      )
    )
    expect(candidate).toContain(
      "partition by d.organisation_id order by job_kind_rank(d.kind), d.due_at, d.id"
    )
    expect(candidate).toContain(
      "order by ranked.kind_rank, ranked.due_at, ranked.id limit p_limit"
    )
  })

  it("re-issues the grants and is in the manifest", () => {
    expect(priority).toMatch(
      /grant execute on function claim_due_jobs\(integer, integer, integer, text\[\]\)\s+to naba_app_runtime/
    )
    expect(priority).toMatch(
      /grant execute on function release_unstarted_job\(text, uuid, uuid\)\s+to naba_app_runtime/
    )
    expect(REQUIRED_MIGRATIONS).toContain("0147_job_claim_priority")
  })

  describe("against PGlite", () => {
    let db: PGlite
    const BUSY = "00000000-0000-4000-8000-0000000000b1"
    const QUIET = "00000000-0000-4000-8000-0000000000b2"
    const CONNECTION = "00000000-0000-4000-8000-0000000000c1"
    const id = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
    const external = (n: number) =>
      `00000000-0000-4000-8000-${String(900_000 + n).padStart(12, "0")}`

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location (id uuid primary key);
        create table google_connection (id uuid primary key, status text);
        create table external_location (id uuid primary key, google_connection_id uuid);
        create table location_link (external_location_id uuid, is_active boolean);
        create table connection_task (google_connection_id uuid, task_type text, status text);
        create table notification_incident (kind text);
        create table processed_webhook_event (
          id uuid primary key, organisation_id uuid, external_location_id uuid,
          status text, retry_count integer default 0, claim_count integer default 0,
          next_attempt_at timestamptz, processed_at timestamptz,
          lease_expires_at timestamptz
        );
        create table sync_checkpoint (
          id uuid primary key, organisation_id uuid, external_location_id uuid,
          sync_type text, status text, next_attempt_at timestamptz,
          started_at timestamptz, lease_expires_at timestamptz,
          attempt_count integer default 0, dead_lettered_at timestamptz,
          scheduled_for timestamptz, last_error_code text
        );
        create table publish_attempt (
          id uuid primary key, organisation_id uuid, status text,
          recovery_attempts integer default 0, attempt_no integer default 1,
          next_attempt_at timestamptz, started_at timestamptz default now(),
          lease_expires_at timestamptz
        );
        insert into organisation values ('${BUSY}'), ('${QUIET}');
        insert into google_connection values ('${CONNECTION}', 'active');
      `)
      await db.exec(read("0086_mutation_operation.sql"))
      await db.exec(latest)
      await db.exec(priority)
    })

    afterAll(async () => {
      await db.close()
    })

    const claim = async (limit: number, perOrg: number) =>
      (
        await db.query<{ kind: string; job_id: string; organisation_id: string }>(
          `select kind, job_id::text, organisation_id::text
             from claim_due_jobs($1, 60, $2)`,
          [limit, perOrg]
        )
      ).rows

    const clear = () =>
      db.exec(`
        delete from processed_webhook_event;
        delete from sync_checkpoint;
        delete from publish_attempt;
        delete from mutation_operation;
        delete from location_link;
        delete from external_location;
      `)

    /** A reconcile herd: `count` linked locations, all due `minutesAgo`. */
    async function herd(organisationId: string, count: number, from: number) {
      for (let n = from; n < from + count; n += 1) {
        await db.exec(`
          insert into external_location values ('${external(n)}', '${CONNECTION}');
          insert into location_link values ('${external(n)}', true);
          insert into sync_checkpoint (id, organisation_id, external_location_id, sync_type, status, next_attempt_at)
          values ('${id(n)}', '${organisationId}', '${external(n)}', 'reconcile', 'succeeded', now() - interval '10 minutes');
        `)
      }
    }

    it("claims a retry that fell due after a recurring herd in the first batch", async () => {
      await clear()
      await herd(BUSY, 6, 100)
      await herd(QUIET, 6, 200)
      // Due well after every herd row, in the busy organisation.
      await db.exec(`
        insert into publish_attempt (id, organisation_id, status, next_attempt_at)
        values ('${id(1)}', '${BUSY}', 'retryable', now() - interval '1 second');
        insert into publish_attempt (id, organisation_id, status, next_attempt_at)
        values ('${id(2)}', '${QUIET}', 'ambiguous', now() - interval '2 seconds');
      `)
      // Ordered by due time alone, a batch of 2 is two herd rows and a cap
      // of 3 per organisation keeps the retry out of the busy one's share.
      const rows = await claim(2, 3)
      expect(rows.map((row) => row.kind).sort()).toEqual(["recover", "retry"])
    })

    it("ranks backfill and sweep checkpoints between user work and recurring syncs", async () => {
      await clear()
      await herd(BUSY, 3, 300)
      await db.exec(`
        insert into sync_checkpoint (id, organisation_id, external_location_id, sync_type, status, next_attempt_at)
        values ('${id(3)}', '${BUSY}', '${external(300)}', 'backfill', 'pending', now() - interval '1 second');
        insert into processed_webhook_event (id, organisation_id, status, retry_count, next_attempt_at)
        values ('${id(4)}', '${BUSY}', 'failed', 0, now());
      `)
      const rows = await claim(10, 3)
      expect(rows.map((row) => row.kind).sort()).toEqual(
        ["checkpoint", "reconcile", "webhook"].sort()
      )
    })

    describe("release_unstarted_job", () => {
      const release = (kind: string, organisationId: string, jobId: string) =>
        db.query(`select release_unstarted_job($1, $2, $3)`, [
          kind,
          organisationId,
          jobId,
        ])

      it("puts every claimed kind back as claimable as it was", async () => {
        await clear()
        await db.exec(`
          insert into external_location values ('${external(1)}', '${CONNECTION}');
          insert into location_link values ('${external(1)}', true);
          insert into processed_webhook_event (id, organisation_id, status, retry_count, next_attempt_at)
          values ('${id(10)}', '${BUSY}', 'failed', 2, now() - interval '1 minute');
          insert into sync_checkpoint (id, organisation_id, external_location_id, sync_type, status, next_attempt_at, last_error_code)
          values ('${id(11)}', '${BUSY}', '${external(1)}', 'backfill', 'pending', now() - interval '1 minute', null),
                 ('${id(12)}', '${BUSY}', '${external(1)}', 'sweep', 'failed', now() - interval '1 minute', 'google_unavailable'),
                 ('${id(13)}', '${BUSY}', '${external(1)}', 'reconcile', 'succeeded', now() - interval '1 minute', null);
          insert into publish_attempt (id, organisation_id, status, next_attempt_at)
          values ('${id(14)}', '${BUSY}', 'ambiguous', now() - interval '1 minute'),
                 ('${id(15)}', '${BUSY}', 'retryable', now() - interval '1 minute');
          insert into mutation_operation
            (id, organisation_id, intent_id, surface, action, payload_hash, state,
             recovery_attempts, next_recovery_at)
          values ('${id(16)}', '${BUSY}', '${id(160)}', 'hours', 'publish', '${"a".repeat(64)}', 'uncertain', 0, now() - interval '1 minute');
        `)
        const first = await claim(50, 50)
        expect(first).toHaveLength(7)
        expect(await claim(50, 50)).toEqual([])

        for (const row of first) {
          await release(row.kind, row.organisation_id, row.job_id)
        }

        const again = await claim(50, 50)
        expect(again.map((row) => row.job_id).sort()).toEqual(
          first.map((row) => row.job_id).sort()
        )
        for (const row of again) {
          await release(row.kind, row.organisation_id, row.job_id)
        }
        const { rows: webhook } = await db.query<{
          status: string
          retry_count: number
          lease: string | null
        }>(
          `select status, retry_count, lease_expires_at as lease
             from processed_webhook_event where id = $1`,
          [id(10)]
        )
        // Nothing spent: the retry budget counts failures, not claims.
        expect(webhook).toEqual([{ status: "failed", retry_count: 2, lease: null }])
        const { rows: checkpoints } = await db.query<{ status: string }>(
          `select status from sync_checkpoint where id = any($1::uuid[]) order by id`,
          [[id(11), id(12), id(13)]]
        )
        expect(checkpoints.map((row) => row.status)).toEqual([
          "pending",
          "failed",
          "succeeded",
        ])
      })

      it("leaves a row it no longer holds alone", async () => {
        await clear()
        await db.exec(`
          insert into processed_webhook_event (id, organisation_id, status, retry_count, next_attempt_at, processed_at)
          values ('${id(20)}', '${BUSY}', 'processed', 0, null, now());
        `)
        await release("webhook", BUSY, id(20))
        const { rows } = await db.query<{ status: string }>(
          `select status from processed_webhook_event where id = $1`,
          [id(20)]
        )
        expect(rows).toEqual([{ status: "processed" }])
      })
    })
  })
})
