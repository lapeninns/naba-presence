import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL

type Sql = ReturnType<typeof postgres>

/** The tenant predicate as PostgreSQL prints it back (pg_get_expr). */
const TENANT_PREDICATE =
  "(organisation_id = (NULLIF(current_setting('app.organisation_id'::text, true), ''::text))::uuid)"

/**
 * Tables with an organisation_id column that do not have RLS enabled and
 * forced. Each must be content-free platform state that the app reads and
 * writes outside withTenant.
 */
const RLS_EXEMPT: Record<string, string> = {
  // 0097: the daily retention walk spans tenants and holds organisation ids,
  // statuses and row counts only; it is read and written outside withTenant.
  retention_cycle_org: "platform-level retention progress (0097)",
}

/**
 * Organisation tables that do not carry the standard tenant_isolation
 * policy (FOR ALL, every role, USING and WITH CHECK on app.organisation_id).
 * Each entry pins the table's complete policy set, `name:command:roles`.
 */
const NON_STANDARD_POLICIES: Record<
  string,
  { reason: string; policies: string[] }
> = {
  // 0001: the session row is also found by its token hash before the
  // organisation is known (sign-in, switching organisation).
  app_session: {
    reason: "session lookup by token hash",
    policies: ["session_isolation:*:public"],
  },
  // 0112: forced RLS and no policy; the runtime role holds no privilege and
  // reaches the rows only through SECURITY DEFINER functions.
  billing_event: {
    reason: "definer-function access only (0112)",
    policies: [],
  },
  // 0005: routing table, world-readable to the runtime role; rows are written
  // only by the SECURITY DEFINER organisation trigger.
  organisation_job_route: {
    reason: "routing read across tenants (0005)",
    policies: ["organisation_job_route_read:r:naba_app_runtime"],
  },
  retention_cycle_org: {
    reason: "no RLS, see RLS_EXEMPT",
    policies: [],
  },
  // 0005: a webhook names a Google account before any organisation is known,
  // so reads resolve across tenants; every write is tenant-checked.
  webhook_route: {
    reason: "webhook routing read across tenants (0005)",
    policies: [
      "webhook_route_claim:a:public",
      "webhook_route_delete_own:d:public",
      "webhook_route_resolve:r:naba_app_runtime",
      "webhook_route_update_own:w:public",
    ],
  },
}

/**
 * Every policy in `public` whose USING and WITH CHECK read no session
 * setting: they admit rows from every tenant. Adding one is a security
 * decision, so the list is exact. billing_plan and the ops pause tables are
 * platform catalogues with no tenant content (0107, 0090); the routing reads
 * and organisation_provision are pinned to the runtime role (0005, and
 * tests/integration/data-api-grants.test.ts).
 */
const SETTING_FREE_POLICIES = [
  "billing_plan.billing_plan_read:r:public",
  "ops_pause_control.ops_pause_control_read:r:public",
  "ops_pause_event.ops_pause_event_read:r:public",
  "organisation.organisation_provision:a:naba_app_runtime",
  "organisation_job_route.organisation_job_route_read:r:naba_app_runtime",
  "webhook_route.webhook_route_resolve:r:naba_app_runtime",
]

/**
 * Table privileges granted directly to naba_app_runtime, by privilege set.
 * A table that is missing here or listed under the wrong set fails: a new
 * migration's grants must be reviewed into this list.
 */
const RUNTIME_TABLE_GRANTS: Record<string, string[]> = {
  // Only SECURITY DEFINER functions touch it (0112).
  none: ["billing_event"],
  SELECT: [
    "abuse_rate_bucket",
    "billing_plan",
    "gbp_local_post_legacy_schedule",
    "mfa_pending_login",
    "notification_delivery_event",
    "ops_pause_control",
    "ops_pause_event",
    "organisation_feature",
    "schema_migration",
  ],
  // Append-only decisions and ledgers: no update, no delete.
  "INSERT,SELECT": [
    "ai_credit_period",
    "mutation_approval_decision",
    "notification_digest",
    "post_approval_decision",
    "review_link_click", // S2
  ],
  // Kept for audit or recovery: no delete.
  "INSERT,SELECT,UPDATE": [
    "bulk_listing_child",
    "bulk_listing_operation",
    "bulk_listing_write_attempt",
    "cron_cursor",
    "fleet_lease",
    "media_asset",
    "media_asset_publication",
    "mutation_operation",
    "ops_heartbeat",
    "organisation_billing",
    "platform_incident",
    "platform_incident_delivery",
    "post_publication_occurrence",
    "post_publication_schedule",
    "report_share",
    "review_link", // S2
    "risc_event",
  ],
  // Updated column by column only (see RUNTIME_COLUMN_GRANTS).
  "DELETE,INSERT,SELECT": [
    "gbp_change_set",
    "google_onboarding_creation",
    "google_onboarding_draft",
    "google_onboarding_match_link",
    "google_onboarding_match_link_review",
    "google_onboarding_review",
    // S1: listing completeness (kept in sorted order)
    "listing_completeness_skip",
    "notification_incident_recipient",
  ],
  "DELETE,INSERT,SELECT,UPDATE": [
    "ai_usage",
    "app_session",
    "app_user",
    "approval_decision",
    "audit_log",
    "client",
    "client_google_connection",
    "connection_task",
    "draft",
    "external_location",
    "food_menu_item_identity",
    "food_menus_state",
    "food_menus_sync_attempt",
    "gbp_local_post",
    "gbp_local_post_attempt",
    "gbp_management_mutation",
    "gbp_media_item",
    "gbp_media_mutation",
    "gbp_resource_snapshot",
    "google_account",
    "google_connection",
    "google_rate_bucket",
    "hours_sync_attempt",
    "invitation",
    "invitation_delivery",
    "legal_hold",
    "location",
    "location_link",
    "location_member",
    "member",
    "notification_delivery",
    "notification_incident",
    "notification_preference",
    "notification_recipient_state",
    "organisation",
    "organisation_job_route",
    "performance_metric_daily",
    "performance_search_keyword_monthly",
    "place_action_link",
    "place_action_mutation",
    "presence_canonical_resource",
    "presence_import_proposal",
    "presence_resource_reconcile_state",
    "privacy_request",
    "processed_webhook_event",
    "profile_field_state",
    "profile_sync_attempt",
    "publish_attempt",
    "publish_attempt_event",
    "retention_cycle",
    "retention_cycle_org",
    "review",
    "review_media_item",
    "review_reply",
    // S3: review topics (0153).
    "review_topic",
    "review_topic_classification",
    "sync_checkpoint",
    "verification_result",
    "webhook_route",
  ],
}

/**
 * Column privileges granted to naba_app_runtime, `column:privileges`. The
 * approval columns are the only part of a change set or onboarding review
 * the app may rewrite.
 */
const RUNTIME_COLUMN_GRANTS: Record<string, string[]> = {
  ai_credit_period: ["ends_at:UPDATE"],
  external_location: [
    "google_average_rating:SELECT,UPDATE",
    "google_total_review_count:SELECT,UPDATE",
    "provider_totals_refreshed_at:SELECT,UPDATE",
  ],
  gbp_change_set: [
    "approved_aal:UPDATE",
    "approved_at:UPDATE",
    "approved_by:UPDATE",
    "approved_mfa_verified_at:UPDATE",
    "approved_security_version:UPDATE",
  ],
  gbp_local_post_legacy_schedule: [
    "reviewed_at:UPDATE",
    "reviewed_by:UPDATE",
    "status:UPDATE",
  ],
  google_onboarding_creation: [
    "confirmation_observed_at:UPDATE",
    "confirmation_response:UPDATE",
    "confirmation_state:UPDATE",
    "error_code:UPDATE",
    "execution_state:UPDATE",
    "link_state:UPDATE",
    "location_id:UPDATE",
    "provider_resource_name:UPDATE",
    "provider_response:UPDATE",
    "updated_at:UPDATE",
  ],
  google_onboarding_draft: [
    "match_request_id:UPDATE",
    "match_result:UPDATE",
    "payload:UPDATE",
    "payload_hash:UPDATE",
    "revision:UPDATE",
    "updated_at:UPDATE",
  ],
  google_onboarding_match_link: [
    "attempt_generation:UPDATE",
    "error_code:UPDATE",
    "external_location_id:UPDATE",
    "location_id:UPDATE",
    "state:UPDATE",
    "updated_at:UPDATE",
  ],
  google_onboarding_match_link_review: [
    "approved_at:UPDATE",
    "approved_by:UPDATE",
  ],
  google_onboarding_review: ["approved_at:UPDATE", "approved_by:UPDATE"],
  review: ["search_document:SELECT"],
}

async function organisationTables(sql: Sql) {
  return sql<
    {
      table: string
      rls: boolean
      forced: boolean
      policies: {
        name: string
        cmd: string
        roles: string[]
        using: string | null
        check: string | null
        permissive: boolean
      }[]
    }[]
  >`
    select
      c.relname::text as table,
      c.relrowsecurity as rls,
      c.relforcerowsecurity as forced,
      coalesce(
        (
          select json_agg(
            json_build_object(
              'name', p.polname,
              'cmd', p.polcmd,
              'permissive', p.polpermissive,
              'roles', array(
                select case r when 0 then 'public' else pg_get_userbyid(r)::text end
                from unnest(p.polroles) r
                order by 1
              ),
              'using', pg_get_expr(p.polqual, p.polrelid),
              'check', pg_get_expr(p.polwithcheck, p.polrelid)
            )
            order by p.polname
          )
          from pg_policy p
          where p.polrelid = c.oid
        ),
        '[]'::json
      ) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and exists (
        select 1
        from information_schema.columns col
        where col.table_schema = 'public'
          and col.table_name = c.relname
          and col.column_name = 'organisation_id'
      )
    order by 1
  `
}

/**
 * NP8-G01 / NP1-G01 / NP2-G01: tenant isolation is the top security
 * property, and the migrations that grant it are frozen once merged. This
 * reads the catalogue of the fully migrated database, so a later migration
 * that disables RLS, drops a policy or widens a grant fails here.
 */
describeDatabase("RLS catalogue of the migrated schema", () => {
  let admin: Sql
  let runtime: Sql
  let tables: Awaited<ReturnType<typeof organisationTables>>

  beforeAll(async () => {
    if (!adminUrl || !runtimeUrl) {
      throw new Error(
        "DIRECT_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required."
      )
    }
    admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
    runtime = postgres(runtimeUrl, { max: 1 })
    tables = await organisationTables(admin)
  })

  afterAll(async () => {
    await Promise.all([admin?.end(), runtime?.end()])
  })

  it("finds the organisation-scoped tables", () => {
    // Guards the query itself: an empty catalogue would pass every check.
    expect(tables.length).toBeGreaterThan(70)
    expect(tables.map((t) => t.table)).toEqual(
      expect.arrayContaining(["review", "location", "audit_log", "member"])
    )
  })

  it("enables and forces RLS on every organisation table", () => {
    const unforced = tables
      .filter((t) => !t.rls || !t.forced)
      .map((t) => t.table)
    expect(unforced).toEqual(Object.keys(RLS_EXEMPT).sort())
  })

  it("isolates every organisation table with a tenant policy for every command", () => {
    const nonStandard: Record<string, string[]> = {}
    for (const t of tables) {
      const standard = t.policies.some(
        (p) =>
          p.cmd === "*" &&
          p.permissive &&
          p.roles.length === 1 &&
          (p.roles[0] === "public" || p.roles[0] === "naba_app_runtime") &&
          p.using === TENANT_PREDICATE &&
          (p.check === null || p.check === TENANT_PREDICATE)
      )
      if (!standard) {
        nonStandard[t.table] = t.policies.map(
          (p) => `${p.name}:${p.cmd}:${p.roles.join("+")}`
        )
      }
    }
    expect(nonStandard).toEqual(
      Object.fromEntries(
        Object.entries(NON_STANDARD_POLICIES).map(([table, { policies }]) => [
          table,
          policies,
        ])
      )
    )
  })

  it("adds no permissive policy that widens a standard tenant table", () => {
    // Permissive policies are OR-ed: a second, looser policy beside
    // tenant_isolation would open the table.
    const extra = tables
      .filter((t) => !(t.table in NON_STANDARD_POLICIES))
      .flatMap((t) =>
        t.policies
          .filter(
            (p) =>
              p.permissive &&
              !(
                p.using === TENANT_PREDICATE &&
                (p.check === null || p.check === TENANT_PREDICATE)
              )
          )
          .map((p) => `${t.table}.${p.name}`)
      )
    expect(extra).toEqual([])
  })

  it("admits rows from every tenant only through the pinned routing and catalogue reads", async () => {
    const rows = await admin<{ policy: string }[]>`
      select
        c.relname::text || '.' || p.polname::text || ':' || p.polcmd::text || ':' ||
          array_to_string(
            array(
              select case r when 0 then 'public' else pg_get_userbyid(r)::text end
              from unnest(p.polroles) r
              order by 1
            ),
            '+'
          ) as policy
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          not like '%current_setting(%'
        and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
          not like '%current_setting(%'
      order by 1
    `
    expect(rows.map((r) => r.policy)).toEqual(SETTING_FREE_POLICIES)
  })

  it("defines no view, materialised view or partition that could bypass the table policies", async () => {
    // A view runs with its owner's rights unless security_invoker is set,
    // and the owner bypasses RLS.
    const rows = await admin<{ relname: string; relkind: string }[]>`
      select c.relname::text as relname, c.relkind::text as relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and (c.relkind in ('v', 'm', 'f') or c.relispartition)
    `
    expect(rows).toEqual([])
  })

  it("keeps the runtime roles unprivileged and owning nothing", async () => {
    const [login] = await runtime<{ name: string }[]>`
      select current_user::text as name
    `
    const roles = await admin<
      {
        rolname: string
        rolsuper: boolean
        rolbypassrls: boolean
        rolcreaterole: boolean
        rolcreatedb: boolean
        rolreplication: boolean
        member_of: string[]
      }[]
    >`
      select
        r.rolname::text as rolname, r.rolsuper, r.rolbypassrls,
        r.rolcreaterole, r.rolcreatedb, r.rolreplication,
        array(
          select g.rolname::text
          from pg_auth_members m
          join pg_roles g on g.oid = m.roleid
          where m.member = r.oid
          order by 1
        ) as member_of
      from pg_roles r
      where r.rolname in ('naba_app_runtime', ${login.name})
      order by 1
    `
    expect(roles).toHaveLength(2)
    for (const role of roles) {
      expect(role).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
      })
    }
    expect(roles.find((r) => r.rolname === login.name)?.member_of).toEqual([
      "naba_app_runtime",
    ])
    const owned = await admin<{ relname: string }[]>`
      select c.relname::text as relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and pg_get_userbyid(c.relowner) in ('naba_app_runtime', ${login.name})
    `
    // An owner may disable or bypass forced RLS.
    expect(owned).toEqual([])
  })

  it("grants naba_app_runtime exactly the pinned table privileges", async () => {
    const rows = await admin<{ table: string; privileges: string }[]>`
      select
        c.relname::text as table,
        coalesce(
          (
            select string_agg(x.privilege_type, ',' order by x.privilege_type)
            from aclexplode(c.relacl) x
            where x.grantee = (
              select oid from pg_roles where rolname = 'naba_app_runtime'
            )
          ),
          'none'
        ) as privileges
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1
    `
    const actual: Record<string, string[]> = {}
    for (const { table, privileges } of rows) {
      ;(actual[privileges] ??= []).push(table)
    }
    expect(actual).toEqual(RUNTIME_TABLE_GRANTS)
  })

  it("grants naba_app_runtime exactly the pinned column privileges", async () => {
    const rows = await admin<
      { table: string; column: string; privileges: string }[]
    >`
      select
        c.relname::text as table,
        a.attname::text as column,
        string_agg(x.privilege_type, ',' order by x.privilege_type) as privileges
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(a.attacl) x
      where n.nspname = 'public'
        and x.grantee = (
          select oid from pg_roles where rolname = 'naba_app_runtime'
        )
      group by 1, 2
      order by 1, 2
    `
    const actual: Record<string, string[]> = {}
    for (const { table, column, privileges } of rows) {
      ;(actual[table] ??= []).push(`${column}:${privileges}`)
    }
    expect(actual).toEqual(RUNTIME_COLUMN_GRANTS)
  })

  it("grants nothing on public relations to PUBLIC or any role but the owner and naba_app_runtime", async () => {
    // TRUNCATE in particular ignores RLS; no role may hold it.
    const rows = await admin<
      { object: string; grantee: string; privilege: string }[]
    >`
      select
        c.relname::text as object,
        coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee,
        x.privilege_type as privilege
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) x
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        and x.grantee <> c.relowner
        and (
          x.grantee is distinct from (
            select oid from pg_roles where rolname = 'naba_app_runtime'
          )
          or x.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
        )
      order by 1, 2, 3
    `
    expect(rows).toEqual([])
  })

  it("keeps a forced-RLS table without a policy closed to the runtime role", async () => {
    // billing_event's deny-all state, proven as the app connects.
    await expect(
      runtime`select count(*) from billing_event`
    ).rejects.toMatchObject({ code: "42501" })
  })
})
