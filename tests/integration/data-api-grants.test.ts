import { execFile } from "node:child_process"
import { promisify } from "node:util"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL

type Sql = ReturnType<typeof postgres>

/** The roles PostgREST and pg_graphql switch to on hosted Supabase. */
const API_ROLES = ["anon", "authenticated", "service_role"] as const

const LOCAL_ORGANISATION_ID = "00000000-0000-4000-8000-000000000001"
const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000002"

/**
 * Every object in `public` an API role can reach. Expected: no rows.
 *
 * Schema usage is checked through direct ACL entries only: since PostgreSQL
 * 15 PUBLIC keeps USAGE on `public`, so has_schema_privilege is true for any
 * role. Likewise only SECURITY DEFINER functions are checked with
 * has_function_privilege: an invoker function still carries PostgreSQL's
 * default PUBLIC execute, but runs as the caller, which holds no table
 * grants. Trigger functions cannot be called directly.
 */
async function apiExposure(sql: Sql) {
  return sql<{ role: string; kind: string; object: string }[]>`
    with api_role as (
      select r.oid, r.rolname
      from pg_roles r
      where r.rolname in ${sql(API_ROLES)}
    )
    select a.rolname as role, 'relation' as kind, c.relname::text as object
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join api_role a
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        has_table_privilege(
          a.oid,
          c.oid,
          'select, insert, update, delete, truncate, references, trigger'
        )
        or has_any_column_privilege(
          a.oid,
          c.oid,
          'select, insert, update, references'
        )
      )
    union all
    select a.rolname, 'sequence', c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join api_role a
    where n.nspname = 'public'
      and c.relkind = 'S'
      and has_sequence_privilege(a.oid, c.oid, 'usage, select, update')
    union all
    select a.rolname, 'function grant', p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) acl
    join api_role a on a.oid = acl.grantee
    where n.nspname = 'public'
    union all
    select a.rolname, 'security definer', p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join api_role a
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege(a.oid, p.oid, 'execute')
    union all
    select a.rolname, 'schema grant', n.nspname::text
    from pg_namespace n
    cross join lateral aclexplode(n.nspacl) acl
    join api_role a on a.oid = acl.grantee
    where n.nspname = 'public'
    order by 1, 2, 3
  `
}

/**
 * SECURITY DEFINER functions in `public` executable by anyone other than
 * their owner and naba_app_runtime, PUBLIC included. Expected: no rows.
 */
async function definerFunctionsOpenBeyondRuntime(sql: Sql) {
  return sql<{ fn: string; grantee: string }[]>`
    select
      p.oid::regprocedure::text as fn,
      coalesce(pg_get_userbyid(nullif(acl.grantee, 0)), 'PUBLIC') as grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee <> p.proowner
      and acl.grantee is distinct from (
        select oid from pg_roles where rolname = 'naba_app_runtime'
      )
    order by 1, 2
  `
}

/** Roles of the policies that are not keyed on a tenant GUC. */
async function routingPolicyRoles(sql: Sql) {
  return sql<{ policy: string; roles: string[] }[]>`
    select
      p.polname::text as policy,
      array(
        select case r when 0 then 'public' else pg_get_userbyid(r)::text end
        from unnest(p.polroles) r
        order by 1
      ) as roles
    from pg_policy p
    where p.polname in (
      'webhook_route_resolve',
      'organisation_job_route_read',
      'organisation_provision'
    )
    order by 1
  `
}

/**
 * SEC-11 / W6-01: hosted Supabase gives anon, authenticated and service_role
 * default grants on everything the migrating role creates in `public`, and
 * migration 0132 takes them away. The throwaway cluster has no such roles,
 * so this suite recreates Supabase's defaults on a database of its own
 * before migrating it, then reads the catalogue. On a database that already
 * has the roles (local Supabase), the shared test database is checked too.
 */
describeDatabase("Data API exposure of the public schema (SEC-11)", () => {
  let admin: Sql
  let runtime: Sql
  let simulated: Sql
  let simulatedName: string
  const createdRoles: string[] = []

  beforeAll(async () => {
    if (!adminUrl || !runtimeUrl) {
      throw new Error(
        "DIRECT_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required."
      )
    }
    admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
    runtime = postgres(runtimeUrl, { max: 1 })

    for (const role of API_ROLES) {
      const [existing] = await admin`
        select 1 from pg_roles where rolname = ${role}
      `
      if (!existing) {
        await admin.unsafe(`create role ${role} nologin`)
        createdRoles.push(role)
      }
    }

    simulatedName = `naba_sec11_${crypto.randomUUID().replaceAll("-", "")}`
    await admin.unsafe(`create database ${simulatedName}`)
    const simulatedUrl = new URL(adminUrl)
    simulatedUrl.pathname = `/${simulatedName}`
    simulated = postgres(simulatedUrl.toString(), {
      max: 1,
      onnotice: () => {},
    })

    // What Supabase's bootstrap runs as the project admin.
    const roles = API_ROLES.join(", ")
    await simulated.unsafe(`
      grant usage on schema public to ${roles};
      alter default privileges in schema public
        grant all on tables to ${roles};
      alter default privileges in schema public
        grant all on sequences to ${roles};
      alter default privileges in schema public
        grant all on functions to ${roles};
    `)

    await promisify(execFile)("node", ["scripts/db-migrate.mjs"], {
      env: { ...process.env, DIRECT_DATABASE_URL: simulatedUrl.toString() },
      maxBuffer: 16 * 1024 * 1024,
    })
  }, 300_000)

  afterAll(async () => {
    await simulated?.end()
    if (simulatedName) {
      await admin.unsafe(
        `drop database if exists ${simulatedName} with (force)`
      )
    }
    for (const role of createdRoles) {
      await admin.unsafe(`drop role if exists ${role}`)
    }
    await Promise.all([admin?.end(), runtime?.end()])
  })

  it("would have exposed public to the API roles without 0132", async () => {
    // Guards the simulation itself: a table created before the revoke would
    // carry the default grants. Created and checked in one rolled-back
    // transaction, after re-adding the defaults 0132 removed.
    const exposed = await simulated
      .begin(async (sql) => {
        await sql.unsafe(`
          alter default privileges in schema public
            grant all on tables to anon;
          create table sec11_probe (id int);
        `)
        const [row] = await sql<{ granted: boolean }[]>`
          select has_table_privilege('anon', 'sec11_probe', 'select')
            as granted
        `
        throw Object.assign(new Error("rollback"), { granted: row.granted })
      })
      .catch((error: { granted?: boolean }) => error.granted)
    expect(exposed).toBe(true)
  })

  it("leaves the API roles nothing in public after migrating", async () => {
    expect(await apiExposure(simulated)).toEqual([])
  })

  it("stops future objects inheriting API-role grants", async () => {
    const leaked = await simulated
      .begin(async (sql) => {
        await sql.unsafe(`
          create table sec11_future (id int generated always as identity);
          create function sec11_future_fn() returns int
            language sql security definer as 'select 1';
          revoke all on function sec11_future_fn() from public;
        `)
        const rows = await apiExposure(sql as unknown as Sql)
        throw Object.assign(new Error("rollback"), { rows })
      })
      .catch((error: { rows?: unknown }) => error.rows)
    expect(leaked).toEqual([])
    const defaults = await simulated<{ acl: string }[]>`
      select d.defaclacl::text as acl
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public'
        and d.defaclrole = (select oid from pg_roles where rolname = current_user)
    `
    for (const { acl } of defaults) {
      for (const role of API_ROLES) expect(acl).not.toContain(`${role}=`)
    }
  })

  it("leaves no API exposure in the shared test database", async () => {
    expect(await apiExposure(admin)).toEqual([])
  })

  it("lets only the owner and naba_app_runtime execute SECURITY DEFINER functions", async () => {
    expect(await definerFunctionsOpenBeyondRuntime(simulated)).toEqual([])
    expect(await definerFunctionsOpenBeyondRuntime(admin)).toEqual([])
  })

  it("scopes the GUC-free policies to naba_app_runtime", async () => {
    const expected = [
      { policy: "organisation_job_route_read", roles: ["naba_app_runtime"] },
      { policy: "organisation_provision", roles: ["naba_app_runtime"] },
      { policy: "webhook_route_resolve", roles: ["naba_app_runtime"] },
    ]
    expect(await routingPolicyRoles(simulated)).toEqual(expected)
    expect(await routingPolicyRoles(admin)).toEqual(expected)
  })

  it("refuses provision_local_bootstrap for anything but the local identities", async () => {
    const organisationId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    for (const [org, user] of [
      [organisationId, LOCAL_USER_ID],
      [LOCAL_ORGANISATION_ID, userId],
      [organisationId, userId],
    ]) {
      await expect(
        runtime`select provision_local_bootstrap(${org}, ${user})`
      ).rejects.toMatchObject({
        code: "42501",
        message: "provision_local_bootstrap is local-only",
      })
    }
    const touched = await admin`
      select 1 from organisation where id = ${organisationId}
      union all
      select 1 from app_user where id = ${userId}
    `
    expect(touched).toEqual([])
  })
})
