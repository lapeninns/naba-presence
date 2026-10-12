import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const earlier = [
  "0079_post_publication_schedules.sql",
  "0240_post_schedule_quarantine.sql",
  "0241_post_schedule_strict_slot.sql",
  "0242_post_schedule_dispatch.sql",
  "0243_post_schedule_settle.sql",
].map(read)
const migration = read("0244_post_schedule_source_revision.sql")

const ORG = "00000000-0000-4000-8000-00000000000a"
const LOCATION = "00000000-0000-4000-8000-0000000000b1"
const USER = "00000000-0000-4000-8000-0000000000c1"
const HASH = "a".repeat(64)

const content = {
  topic_type: "STANDARD",
  language_code: "en-GB",
  summary: "Sunday roast is back",
  media: [],
}
/** The template frozenTemplate() wrote for `content`. */
const template = {
  topicType: "STANDARD",
  languageCode: "en-GB",
  summary: "Sunday roast is back",
  media: [],
}
const once = { frequency: "once", startDate: "2026-11-01", localTime: "09:00" }
const daily = {
  frequency: "daily",
  startDate: "2026-11-01",
  localTime: "09:00",
  end: { type: "count", count: 2 },
}

describe("0244 schedule source revision migration", () => {
  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0244_post_schedule_source_revision")
  })

  it("grants nothing new and creates no work", () => {
    expect(migration).not.toMatch(/\bgrant\b/i)
    expect(migration).not.toMatch(/insert into (job|post_publication|gbp_)/)
  })

  describe("against PGlite with live rows", () => {
    let db: PGlite
    const ids: Record<string, string> = {}

    async function post(
      overrides: Partial<{
        summary: string
        status: string
        google_post_name: string | null
        content_revision: number
      }> = {}
    ) {
      const result = await db.query<{ id: string }>(
        `insert into gbp_local_post (id, organisation_id, location_id, status, topic_type, language_code,
           summary, media, google_post_name, content_revision)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          ORG,
          LOCATION,
          overrides.status ?? "draft",
          content.topic_type,
          content.language_code,
          overrides.summary ?? content.summary,
          JSON.stringify(content.media),
          overrides.google_post_name ?? null,
          overrides.content_revision ?? 3,
        ]
      )
      return result.rows[0]!.id
    }
    async function schedule(
      source: string | null,
      rule: object,
      status = "active",
      reason: string | null = null
    ) {
      const approved = status !== "awaiting_approval"
      const result = await db.query<{ id: string }>(
        `insert into post_publication_schedule
           (organisation_id, location_id, source_post_id, template, rule, timezone, payload_hash,
            status, status_reason, requested_by, approved_by, approved_revision,
            require_two_person_approval, offset_minutes)
         values ($1, $2, $3, $4, $5, 'Europe/London', $6, $7, $8, $9, $10, $11, false, $12)
         returning id`,
        [
          ORG,
          LOCATION,
          source,
          JSON.stringify(template),
          JSON.stringify(rule),
          HASH,
          status,
          reason,
          USER,
          approved ? USER : null,
          approved ? 1 : null,
          (rule as { frequency: string }).frequency === "once" ? 0 : null,
        ]
      )
      return result.rows[0]!.id
    }
    async function occurrence(
      scheduleId: string,
      status = "scheduled",
      postId: string | null = null,
      minutesAhead = 60
    ) {
      const result = await db.query<{ id: string }>(
        `insert into post_publication_occurrence
           (organisation_id, schedule_id, location_id, schedule_revision,
            intended_at, local_date, local_time, status, post_id)
         values ($1, $2, $3, 1, now() + make_interval(mins => $4), '2026-11-01', '09:00', $5, $6)
         returning id`,
        [ORG, scheduleId, LOCATION, minutesAhead, status, postId]
      )
      return result.rows[0]!.id
    }
    const row = async (table: string, id: string, columns: string) =>
      (
        await db.query<Record<string, unknown>>(
          `select ${columns} from ${table} where id = $1`,
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
          topic_type text,
          language_code text,
          summary text,
          call_to_action jsonb,
          event jsonb,
          offer jsonb,
          media jsonb not null default '[]',
          google_post_name text,
          content_revision bigint not null default 1,
          scheduled_publish_time timestamptz,
          recurrence jsonb
        );
        create table mutation_operation (
          id uuid primary key default gen_random_uuid(),
          organisation_id uuid not null,
          intent_id uuid not null,
          surface text not null,
          target_ref text,
          state text not null,
          error_code text,
          unique (organisation_id, intent_id)
        );
        insert into organisation values ('${ORG}', false);
        insert into app_user values ('${USER}');
        insert into location values ('${LOCATION}');
      `)
      for (const text of earlier) await db.exec(text)

      ids.matchPost = await post()
      ids.match = await schedule(ids.matchPost, once)
      ids.matchRun = await occurrence(ids.match)
      ids.editedPost = await post({ summary: "Edited after scheduling" })
      ids.edited = await schedule(ids.editedPost, once)
      ids.editedRun = await occurrence(ids.edited)
      ids.waitingPost = await post({ summary: "Edited while waiting" })
      ids.waiting = await schedule(ids.waitingPost, once, "awaiting_approval")
      ids.publishedPost = await post({
        status: "published",
        google_post_name: "locations/1/localPosts/9",
      })
      ids.published = await schedule(ids.publishedPost, once, "paused")
      ids.gone = await schedule(null, once)
      ids.blockedPost = await post({ summary: "Changed while blocked" })
      ids.blocked = await schedule(
        ids.blockedPost,
        once,
        "blocked",
        "prior_occurrence_unresolved"
      )
      ids.repeatingPost = await post({ summary: "A repeating copy" })
      ids.repeating = await schedule(ids.repeatingPost, daily)
      ids.ended = await schedule(ids.matchPost, once, "completed")
      // An earlier revision's occurrence that missed with the post attached.
      ids.missedRun = await occurrence(ids.match, "missed", ids.matchPost, -30)

      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    it("binds a live schedule whose template is its source's current content, with no hash", async () => {
      expect(
        await row(
          "post_publication_schedule",
          ids.match,
          "status, status_reason, source_content_revision::int as revision, source_content_hash as hash"
        )
      ).toEqual({
        status: "active",
        status_reason: null,
        revision: 3,
        hash: null,
      })
      expect(
        await row("post_publication_occurrence", ids.matchRun, "status")
      ).toEqual({ status: "scheduled" })
      // An ended schedule is history, not bound.
      expect(
        await row(
          "post_publication_schedule",
          ids.ended,
          "source_content_revision as revision"
        )
      ).toEqual({ revision: null })
    })

    it("sends a one-time schedule it cannot bind to review and cancels its run", async () => {
      for (const id of [ids.edited, ids.waiting])
        expect(
          await row(
            "post_publication_schedule",
            id,
            "status, status_reason, source_content_revision as revision"
          )
        ).toEqual({
          status: "needs_review",
          status_reason: "source_changed",
          revision: null,
        })
      expect(
        await row(
          "post_publication_occurrence",
          ids.editedRun,
          "status, status_reason"
        )
      ).toEqual({ status: "cancelled", status_reason: "schedule_quarantined" })
      for (const id of [ids.published, ids.gone])
        expect(
          await row("post_publication_schedule", id, "status, status_reason")
        ).toEqual({
          status: "needs_review",
          status_reason: "source_superseded",
        })
    })

    it("leaves blocked and repeating schedules to their own paths", async () => {
      expect(
        await row(
          "post_publication_schedule",
          ids.blocked,
          "status, status_reason, source_content_revision as revision"
        )
      ).toEqual({
        status: "blocked",
        status_reason: "prior_occurrence_unresolved",
        revision: null,
      })
      // A repeating schedule publishes its own copy of the template, so a
      // draft edited since does not stop it; the next edit re-freezes it.
      expect(
        await row(
          "post_publication_schedule",
          ids.repeating,
          "status, source_content_revision as revision"
        )
      ).toEqual({ status: "active", revision: null })
    })

    it("lets a later occurrence claim a post an ended one had, but only one live one", async () => {
      // The missed occurrence already holds the post; a live one may too.
      await db.query(
        "update post_publication_occurrence set post_id = $2 where id = $1",
        [ids.matchRun, ids.matchPost]
      )
      const second = await occurrence(ids.match, "scheduled", null, 120)
      await expect(
        db.query(
          "update post_publication_occurrence set post_id = $2 where id = $1",
          [second, ids.matchPost]
        )
      ).rejects.toThrow(/post_publication_occurrence_live_post_idx/)
    })

    it("changes nothing when run again", async () => {
      const snapshot = async () =>
        (
          await db.query(
            `select id, status, status_reason, source_content_revision from post_publication_schedule order by id`
          )
        ).rows
      const before = await snapshot()
      await db.exec(migration)
      expect(await snapshot()).toEqual(before)
    })
  })
})
