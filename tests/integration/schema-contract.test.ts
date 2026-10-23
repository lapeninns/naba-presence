import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ORG_FEATURES } from "@/lib/contracts/org-features"
import { OPERATION_OUTCOMES } from "@/lib/contracts/mutation-operations"
import { MEDIA_UPLOAD_PHASES } from "@/lib/domain/media-reconcile"
import {
  ADDRESSED_KINDS,
  NOTIFICATION_EVENT_KINDS,
} from "@/lib/domain/notification-preferences"
import { retentionDataset } from "@/lib/server/retention/inventory"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL

type Sql = ReturnType<typeof postgres>

type Column = { type: string; notNull: boolean; default: string | null }
type Constraint = { table: string; def: string; validated: boolean }

/**
 * Schema facts the text-only migration tests used to read from frozen SQL
 * (NP1-011, NP2-001), now read from the catalogue of the fully migrated
 * database, so a later migration that drops or narrows them fails here.
 * Forced RLS, tenant policies and runtime grants for every table are in
 * tests/integration/rls-catalogue.test.ts; the TypeScript vocabularies that
 * mirror a CHECK constraint are compared with the live constraint here
 * (NP2-008).
 */
describeDatabase("schema contract of the migrated database", () => {
  let admin: Sql
  const tables = new Set<string>()
  const columns = new Map<string, Column>()
  const constraints = new Map<string, Constraint>()
  const indexes = new Map<string, string>()
  const policies = new Set<string>()

  const column = (table: string, name: string) => {
    const found = columns.get(`${table}.${name}`)
    expect(found, `${table}.${name}`).toBeDefined()
    return found!
  }
  const constraint = (name: string) => {
    const found = constraints.get(name)
    expect(found, name).toBeDefined()
    return found!
  }
  const index = (name: string) => {
    const found = indexes.get(name)
    expect(found, name).toBeDefined()
    return found!
  }
  /** The quoted values of a `col = ANY (ARRAY['a'::text, ...])` CHECK. */
  const allowed = (name: string) =>
    [...constraint(name).def.matchAll(/'([^']*)'::text/g)].map((m) => m[1])

  beforeAll(async () => {
    if (!adminUrl) throw new Error("DIRECT_DATABASE_URL is required.")
    admin = postgres(adminUrl, { max: 1, onnotice: () => {} })

    for (const row of await admin<{ name: string }[]>`
      select c.relname::text as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    `) {
      tables.add(row.name)
    }
    for (const row of await admin<
      { key: string; type: string; not_null: boolean; default: string | null }[]
    >`
      select
        c.relname || '.' || a.attname as key,
        format_type(a.atttypid, a.atttypmod) as type,
        a.attnotnull as not_null,
        pg_get_expr(d.adbin, d.adrelid) as default
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and a.attnum > 0
        and not a.attisdropped
    `) {
      columns.set(row.key, {
        type: row.type,
        notNull: row.not_null,
        default: row.default,
      })
    }
    for (const row of await admin<
      { name: string; table: string; def: string; validated: boolean }[]
    >`
      select
        conname::text as name,
        conrelid::regclass::text as table,
        pg_get_constraintdef(oid) as def,
        convalidated as validated
      from pg_constraint
      where connamespace = 'public'::regnamespace and conrelid <> 0
    `) {
      constraints.set(row.name, {
        table: row.table,
        def: row.def,
        validated: row.validated,
      })
    }
    for (const row of await admin<{ name: string; def: string }[]>`
      select indexname::text as name, indexdef as def
      from pg_indexes
      where schemaname = 'public'
    `) {
      indexes.set(row.name, row.def)
    }
    for (const row of await admin<{ key: string }[]>`
      select c.relname || '.' || p.polname as key
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
    `) {
      policies.add(row.key)
    }
  })

  afterAll(async () => {
    await admin?.end()
  })

  it("reads a populated catalogue", () => {
    // Guards the loaders: empty maps would fail every lookup anyway, but
    // say so plainly.
    expect(tables.size).toBeGreaterThan(80)
    expect(constraints.size).toBeGreaterThan(300)
  })

  // Was tests/performance-migration.test.ts (0014).
  describe("performance metrics", () => {
    it("keeps daily metrics non-negative, unique and range-indexed", () => {
      expect(column("performance_metric_daily", "value")).toEqual({
        type: "bigint",
        notNull: true,
        default: null,
      })
      expect(constraint("performance_metric_daily_value_check").def).toBe(
        "CHECK ((value >= 0))"
      )
      expect(index("performance_metric_daily_range_idx")).toContain(
        "(organisation_id, metric_date, external_location_id, metric)"
      )
      expect(policies).toContain(
        "performance_metric_daily.performance_metric_daily_isolation"
      )
    })

    it("keeps a performance checkpoint with a local-date watermark", () => {
      expect(column("sync_checkpoint", "last_metric_date").type).toBe("date")
      expect(allowed("sync_checkpoint_sync_type_check")).toContain(
        "performance"
      )
      expect(index("performance_checkpoint_due_idx")).toMatch(
        /\(organisation_id, next_attempt_at\) WHERE \(\(sync_type = 'performance'::text\)/
      )
    })
  })

  // Was tests/posts-migration.test.ts (0015, 0037, 0116); the source guard
  // on the request contract stays in that file.
  describe("local posts", () => {
    it("stores tenant-scoped posts and their pre-provider intent", () => {
      expect(tables).toContain("gbp_local_post")
      expect(column("gbp_local_post_attempt", "intended_payload")).toEqual({
        type: "jsonb",
        notNull: true,
        default: null,
      })
      expect(policies).toContain("gbp_local_post.gbp_local_post_isolation")
      expect(policies).toContain(
        "gbp_local_post_attempt.gbp_local_post_attempt_isolation"
      )
      expect(column("gbp_local_post", "google_search_url").type).toBe("text")
    })

    it("allows drafts, approval, provider failure, ambiguity and deletion", () => {
      expect(new Set(allowed("gbp_local_post_status_check"))).toEqual(
        new Set([
          "draft",
          "awaiting_approval",
          "publishing",
          "published",
          "failed",
          "ambiguous",
          "deleted",
        ])
      )
    })

    it("bounds the publish claim with a lease only publishing rows index", () => {
      expect(column("gbp_local_post", "publish_lease_expires_at").type).toBe(
        "timestamp with time zone"
      )
      expect(index("gbp_local_post_publish_lease_idx")).toMatch(
        /WHERE \(status = 'publishing'::text\)$/
      )
    })

    it("marks the legacy per-post schedule columns deprecated and keeps their review table", async () => {
      const rows = await admin<{ column: string; comment: string | null }[]>`
        select a.attname::text as column, col_description(a.attrelid, a.attnum) as comment
        from pg_attribute a
        where a.attrelid = 'gbp_local_post'::regclass
          and a.attname in ('scheduled_publish_time', 'recurrence')
        order by 1
      `
      expect(rows.map((r) => r.column)).toEqual([
        "recurrence",
        "scheduled_publish_time",
      ])
      for (const row of rows) expect(row.comment).toMatch(/^Deprecated/)
      expect(tables).toContain("gbp_local_post_legacy_schedule")
    })
  })

  // Was tests/profile-migration.test.ts (0016). Its
  // pinned_projection_revision assertion was already stale: 0024 renamed the
  // column to pinned_canonical_revision.
  describe("profile management", () => {
    it("keeps field state and an idempotent operation ledger", () => {
      expect(tables).toContain("profile_field_state")
      expect(column("profile_sync_attempt", "idempotency_key")).toMatchObject({
        type: "text",
        notNull: true,
      })
      expect(
        constraint("profile_sync_attempt_organisation_id_idempotency_key_key")
          .def
      ).toBe("UNIQUE (organisation_id, idempotency_key)")
      expect(
        column("profile_sync_attempt", "pinned_canonical_revision")
      ).toMatchObject({ type: "text", notNull: true })
    })

    it("indexes field state and attempts by location", () => {
      expect(index("profile_field_state_location_status_idx")).toContain(
        "(organisation_id, external_location_id, status, updated_at DESC)"
      )
      expect(index("profile_sync_attempt_location_idx")).toContain(
        "(organisation_id, external_location_id, created_at DESC)"
      )
    })
  })

  // Was tests/keywords-migration.test.ts (0017).
  describe("search keyword performance", () => {
    it("stores an exact or a thresholded value, never both", () => {
      expect(constraint("performance_search_keyword_monthly_check").def).toBe(
        "CHECK ((num_nonnulls(impressions, threshold) = 1))"
      )
      expect(index("performance_search_keyword_monthly_range_idx")).toContain(
        "(organisation_id, metric_month DESC, external_location_id, rank)"
      )
      expect(policies).toContain(
        "performance_search_keyword_monthly.performance_search_keyword_monthly_isolation"
      )
    })

    it("keeps an independent keyword checkpoint and watermark", () => {
      expect(column("sync_checkpoint", "last_keyword_month").type).toBe("date")
      expect(allowed("sync_checkpoint_sync_type_check")).toContain("keywords")
      expect(index("keyword_checkpoint_due_idx")).toMatch(
        /WHERE \(\(sync_type = 'keywords'::text\)/
      )
    })
  })

  // Was tests/place-actions-migration.test.ts (0018).
  describe("place action links", () => {
    it("keeps reconciled links and idempotent, expiring mutation attempts", () => {
      expect(tables).toContain("place_action_link")
      expect(column("place_action_mutation", "expected_google_hash").type).toBe(
        "text"
      )
      expect(
        constraint("place_action_mutation_organisation_id_idempotency_key_key")
          .def
      ).toBe("UNIQUE (organisation_id, idempotency_key)")
      expect(index("place_action_mutation_expiry_idx")).toContain(
        "(organisation_id, expires_at)"
      )
      expect(policies).toContain(
        "place_action_link.place_action_link_isolation"
      )
      expect(policies).toContain(
        "place_action_mutation.place_action_mutation_isolation"
      )
    })
  })

  // Was tests/media-migration.test.ts (0019, 0093) and
  // tests/presence-retention-migration.test.ts (0022).
  describe("media", () => {
    it("keeps merchant and customer media with attribution", () => {
      expect(new Set(allowed("gbp_media_item_ownership_check"))).toEqual(
        new Set(["merchant", "customer"])
      )
      expect(column("gbp_media_item", "attribution").type).toBe("jsonb")
      expect(index("gbp_media_mutation_expiry_idx")).toContain(
        "(organisation_id, expires_at)"
      )
    })

    it("expires media payloads after 30 days by default", () => {
      expect(column("gbp_media_item", "payload_expires_at")).toEqual({
        type: "timestamp with time zone",
        notNull: true,
        default: "(now() + '30 days'::interval)",
      })
    })

    it("keeps the upload checkpoint, content and resolution columns", () => {
      expect(column("gbp_media_mutation", "started_at")).toEqual({
        type: "timestamp with time zone",
        notNull: true,
        default: "now()",
      })
      expect(column("gbp_media_mutation", "upload_data_ref").type).toBe("text")
      expect(column("gbp_media_mutation", "content_sha256").type).toBe("text")
      expect(constraint("gbp_media_mutation_resolution_check").def).toBe(
        "CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['adopted'::text, 'abandoned'::text]))))"
      )
    })

    it("checks upload_phase against the phases lib/domain/media-reconcile.ts records", () => {
      expect(column("gbp_media_mutation", "upload_phase")).toEqual({
        type: "text",
        notNull: true,
        default: "'none'::text",
      })
      expect(allowed("gbp_media_mutation_upload_phase_check")).toEqual([
        ...MEDIA_UPLOAD_PHASES,
      ])
    })

    it("keeps every mutation status, needs_resolution included", () => {
      expect(new Set(allowed("gbp_media_mutation_status_check"))).toEqual(
        new Set([
          "started",
          "succeeded",
          "failed",
          "ambiguous",
          "needs_resolution",
        ])
      )
    })
  })

  // Was tests/presence-retention-migration.test.ts (0022).
  describe("local post attempt retention", () => {
    it("indexes attempt expiry for the purge", () => {
      expect(index("gbp_local_post_attempt_expiry_idx")).toContain(
        "(organisation_id, expires_at)"
      )
    })
  })

  // Was tests/food-menus-migration.test.ts (0020) and the sync-attempt half
  // of tests/import-review-migration.test.ts (0028).
  describe("food menus", () => {
    it("keeps reconciled state and immutable publish attempts", () => {
      expect(column("food_menus_state", "canonical_payload")).toMatchObject({
        type: "jsonb",
        notNull: true,
      })
      expect(
        column("food_menus_sync_attempt", "intended_payload")
      ).toMatchObject({ type: "jsonb", notNull: true })
      expect(index("food_menus_attempt_expiry_idx")).toContain(
        "(organisation_id, expires_at)"
      )
    })

    it("records imports as well as publishes", () => {
      expect(allowed("food_menus_sync_attempt_operation_check")).toEqual([
        "publish_google",
        "import_google",
      ])
      expect(allowed("food_menus_sync_attempt_direction_check")).toEqual([
        "to_google",
        "to_nabapresence",
      ])
      expect(new Set(allowed("profile_sync_attempt_operation_check"))).toEqual(
        new Set([
          "validate_google",
          "publish_google",
          "import_nabatable",
          "import_google",
          "reconcile",
        ])
      )
      expect(new Set(allowed("profile_sync_attempt_direction_check"))).toEqual(
        new Set(["to_google", "to_nabatable", "to_nabapresence"])
      )
    })
  })

  // Was tests/presence-resource-reconciliation-migration.test.ts (0023).
  // Its "no jsonb" assertion was false for today's schema: 0147 added
  // observed_google_payload jsonb to this table on purpose.
  describe("presence resource reconciliation", () => {
    it("tracks bounded sweeps per resource", () => {
      expect(
        column("presence_resource_reconcile_state", "last_attempt_at")
      ).toMatchObject({ type: "timestamp with time zone", notNull: true })
      expect(
        column("presence_resource_reconcile_state", "last_succeeded_at").type
      ).toBe("timestamp with time zone")
      expect(
        constraint(
          "presence_resource_reconcile_s_organisation_id_location_id_r_key"
        ).def
      ).toBe("UNIQUE (organisation_id, location_id, resource)")
    })
  })

  // Was tests/hours-migration.test.ts (0024). The snapshot copy and venue
  // mapping removal were one-off data steps.
  describe("standalone presence canonical resources", () => {
    it("keeps revisioned canonical resources for profile, hours and menus", () => {
      expect(
        allowed("presence_canonical_resource_resource_type_check")
      ).toEqual(expect.arrayContaining(["profile", "hours", "food_menus"]))
      expect(column("presence_canonical_resource", "revision")).toEqual({
        type: "bigint",
        notNull: true,
        default: "1",
      })
      expect(policies).toContain(
        "presence_canonical_resource.presence_canonical_resource_isolation"
      )
    })

    it("pins attempts to a canonical revision and no longer maps NabaTable venues", () => {
      for (const table of ["hours_sync_attempt", "profile_sync_attempt"]) {
        expect(column(table, "pinned_canonical_revision")).toMatchObject({
          type: "text",
          notNull: true,
        })
      }
      expect(tables).not.toContain("nabatable_venue_link")
    })
  })

  // Was tests/qa-removal-migration.test.ts (0025, NP2-003).
  describe("unsupported Q&A", () => {
    it("has no Q&A tables and reconciles no Q&A resource", () => {
      for (const table of [
        "gbp_question",
        "qa_answer_draft",
        "qa_answer_attempt",
      ])
        expect(tables).not.toContain(table)
      expect(
        allowed("presence_resource_reconcile_state_resource_check")
      ).not.toContain("qa")
    })
  })

  // Was tests/import-review-migration.test.ts (0028).
  describe("import review", () => {
    it("stages suggestion-only proposals", () => {
      expect(
        column("presence_import_proposal", "suggested_patch")
      ).toMatchObject({
        type: "jsonb",
        notNull: true,
      })
      expect(new Set(allowed("presence_import_proposal_status_check"))).toEqual(
        new Set([
          "pending",
          "processing",
          "applied",
          "ignored",
          "failed",
          "superseded",
        ])
      )
      expect(
        new Set(allowed("presence_import_proposal_decision_check"))
      ).toEqual(new Set(["apply", "ignore", "delete_local", "keep_local"]))
      expect(allowed("presence_import_proposal_resource_type_check")).toEqual([
        "profile",
        "food_menus",
      ])
    })

    it("allows one live proposal per identity, in-flight decisions included", () => {
      expect(index("presence_import_proposal_live_key")).toBe(
        "CREATE UNIQUE INDEX presence_import_proposal_live_key ON public.presence_import_proposal USING btree (organisation_id, location_id, resource_type, identity_key) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]))"
      )
    })

    it("pins the concurrency triple on every proposal", () => {
      for (const name of [
        "pinned_canonical_revision",
        "pinned_canonical_hash",
        "pinned_google_hash",
      ]) {
        expect(column("presence_import_proposal", name)).toMatchObject({
          type: "text",
          notNull: true,
        })
      }
    })

    it("keys menu item identities by Google path", () => {
      expect(
        constraint(
          "food_menu_item_identity_organisation_id_location_id_google__key"
        ).def
      ).toBe("UNIQUE (organisation_id, location_id, google_path)")
    })
  })

  // Was tests/invitation-scope-migration.test.ts (0056).
  describe("invitation client scope", () => {
    it("forbids an empty scope and a scope on owners or admins", () => {
      expect(column("invitation", "client_ids").type).toBe("uuid[]")
      expect(constraint("invitation_client_ids_scope_check").def).toBe(
        "CHECK (((client_ids IS NULL) OR ((cardinality(client_ids) > 0) AND (role = ANY (ARRAY['member'::text, 'viewer'::text])))))"
      )
    })
  })

  // Was tests/workspace-mode-migration.test.ts (0061). Its backfill was a
  // one-off data step; sessionSchema's mode is covered by
  // tests/workspace-mode.test.ts.
  describe("workspace mode", () => {
    it("defaults to agency and allows only business or agency", () => {
      expect(column("organisation", "workspace_mode")).toEqual({
        type: "text",
        notNull: true,
        default: "'agency'::text",
      })
      expect(allowed("organisation_workspace_mode_check")).toEqual([
        "business",
        "agency",
      ])
    })

    it("allows one home client and guards it in the database", async () => {
      expect(index("client_one_home")).toBe(
        "CREATE UNIQUE INDEX client_one_home ON public.client USING btree (organisation_id) WHERE is_home"
      )
      const triggers = await admin<
        { table: string; name: string; enabled: string }[]
      >`
        select
          tgrelid::regclass::text as table,
          tgname::text as name,
          tgenabled::text as enabled
        from pg_trigger
        where tgname in ('client_guard_home', 'location_guard_home')
        order by 2
      `
      expect(triggers).toEqual([
        { table: "client", name: "client_guard_home", enabled: "O" },
        { table: "location", name: "location_guard_home", enabled: "O" },
      ])
    })
  })

  // Was tests/invitation-delivery-migration.test.ts (0104).
  describe("invitation delivery", () => {
    it("tracks one delivery table with the shared driver's states", () => {
      expect(new Set(allowed("invitation_delivery_status_check"))).toEqual(
        new Set(["pending", "sent", "failed", "suppressed", "uncertain"])
      )
      expect(column("invitation_delivery", "may_have_sent")).toEqual({
        type: "boolean",
        notNull: true,
        default: "false",
      })
      expect(allowed("invitation_delivery_kind_check")).toEqual([
        "initial",
        "resend",
      ])
    })

    it("ties a delivery to an invitation of its own organisation and goes with it", () => {
      expect(
        constraint("invitation_delivery_organisation_id_invitation_id_fkey").def
      ).toBe(
        "FOREIGN KEY (organisation_id, invitation_id) REFERENCES invitation(organisation_id, id) ON DELETE CASCADE"
      )
      expect(constraint("invitation_organisation_id_id_key").def).toBe(
        "UNIQUE (organisation_id, id)"
      )
    })

    it("allows one pending email per invitation", () => {
      expect(index("invitation_delivery_one_pending_idx")).toBe(
        "CREATE UNIQUE INDEX invitation_delivery_one_pending_idx ON public.invitation_delivery USING btree (invitation_id) WHERE (status = 'pending'::text)"
      )
    })

    it("exposes due organisations through a definer function with a fixed search path", async () => {
      // Who may execute it: tests/integration/data-api-grants.test.ts.
      const [fn] = await admin<
        { definer: boolean; config: string[] | null; result: string }[]
      >`
        select
          prosecdef as definer,
          proconfig as config,
          pg_get_function_result(oid) as result
        from pg_proc
        where oid = 'invitation_delivery_due_organisations(integer)'::regprocedure
      `
      expect(fn).toEqual({
        definer: true,
        config: ["search_path=public"],
        result: "TABLE(organisation_id uuid)",
      })
    })

    it("ships dark behind its own feature and is classified for retention", () => {
      expect(ORG_FEATURES).toContain("invitation_email")
      expect(retentionDataset("invitation_delivery")).toMatchObject({
        action: "keep",
        deletes: "none",
      })
    })
  })

  // Was tests/approval-notification-kinds-migration.test.ts (0149).
  describe("notification incidents", () => {
    it("allows exactly the kinds the app knows, validated", () => {
      const check = constraint("notification_incident_kind_check")
      expect(check.validated).toBe(true)
      const kinds = allowed("notification_incident_kind_check")
      expect(new Set(kinds)).toEqual(new Set(NOTIFICATION_EVENT_KINDS))
      expect(kinds).toHaveLength(NOTIFICATION_EVENT_KINDS.length)
      for (const kind of ADDRESSED_KINDS) expect(kinds).toContain(kind)
    })

    it("addresses incidents through a table that goes with the incident and the person", () => {
      expect(
        constraint("notification_incident_recipient_incident_id_fkey").def
      ).toBe(
        "FOREIGN KEY (incident_id) REFERENCES notification_incident(id) ON DELETE CASCADE"
      )
      expect(
        constraint("notification_incident_recipient_user_id_fkey").def
      ).toBe("FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE")
      expect(
        retentionDataset("notification_incident_recipient")?.approval
      ).toEqual({ status: "lifecycle" })
    })
  })

  // NP2-008: the outcome vocabulary of 0086 and 0094 against the live
  // constraint, not the migration that first wrote it.
  describe("mutation operations", () => {
    it("allows exactly the shared outcome vocabulary, validated", () => {
      const check = constraint("mutation_operation_state_check")
      expect(check.validated).toBe(true)
      const states = allowed("mutation_operation_state_check")
      expect(new Set(states)).toEqual(new Set(OPERATION_OUTCOMES))
      expect(states).toHaveLength(OPERATION_OUTCOMES.length)
    })
  })
})
