import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * PATCH /api/organisations { workspaceMode } (plan P06-5) and migration
 * 0102's guard that a business workspace never gains a second active client.
 */
describeDatabase("workspace mode change", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture(
    options: Parameters<typeof createTestTenant>[1] = {},
    feature = true
  ) {
    const tenant = await createTestTenant(admin, options)
    organisations.push(tenant.organisationId)
    if (feature) {
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${tenant.organisationId}, 'workspace_mode_change', true, 'test')
      `
    }
    return tenant
  }

  const request = (path: string, cookie: string, init: RequestInit = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: {
        cookie,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    })

  const changeMode = (cookie: string, workspaceMode: string) =>
    request("/api/organisations", cookie, {
      method: "PATCH",
      body: JSON.stringify({ workspaceMode }),
    })

  async function seedClient(
    organisationId: string,
    name: string,
    archived = false
  ) {
    const id = randomUUID()
    await admin`
      insert into client (id, organisation_id, name, slug, archived_at)
      values (
        ${id},
        ${organisationId},
        ${name},
        ${`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 6)}`},
        ${archived ? new Date() : null}
      )
    `
    return id
  }

  async function seedLocation(
    organisationId: string,
    name: string,
    clientId: string | null = null
  ) {
    const id = randomUUID()
    await admin`
      insert into location (id, organisation_id, name, client_id)
      values (${id}, ${organisationId}, ${name}, ${clientId})
    `
    return id
  }

  async function shape(organisationId: string) {
    const [row] = await admin<
      { mode: string; homeId: string | null; activeClients: number }[]
    >`
      select
        o.workspace_mode as mode,
        (select c.id::text from client c
          where c.organisation_id = o.id and c.is_home) as "homeId",
        (select count(*)::int from client c
          where c.organisation_id = o.id and c.archived_at is null)
          as "activeClients"
      from organisation o
      where o.id = ${organisationId}
    `
    return row
  }

  async function modeAudits(organisationId: string) {
    return admin<{ actorUserId: string; metadata: Record<string, unknown> }[]>`
      select actor_user_id::text as "actorUserId", metadata
      from audit_log
      where organisation_id = ${organisationId}
        and action = 'organisation.mode.changed'
      order by created_at
    `
  }

  it("is owner-only", async () => {
    for (const role of ["admin", "member", "viewer"] as const) {
      const tenant = await fixture({ role })
      const response = await changeMode(tenant.cookie, "business")
      expect(response.status).toBe(403)
      expect((await shape(tenant.organisationId)).mode).toBe("agency")
    }
  })

  it("stays dark until the organisation's workspace_mode_change feature is on", async () => {
    const owner = await fixture({}, false)
    const response = await changeMode(owner.cookie, "business")
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "workspace_mode_change_unavailable",
    })
    expect((await shape(owner.organisationId)).mode).toBe("agency")
  })

  it("refuses a rename and a mode change in one request", async () => {
    const owner = await fixture()
    const response = await request("/api/organisations", owner.cookie, {
      method: "PATCH",
      body: JSON.stringify({ name: "Both", workspaceMode: "business" }),
    })
    expect(response.status).toBe(400)
  })

  it("keeps the home client as an ordinary visible client when a business becomes an agency", async () => {
    const owner = await fixture({ workspaceMode: "business" })
    const before = await shape(owner.organisationId)
    const location = await seedLocation(
      owner.organisationId,
      "Flagship",
      before.homeId
    )

    const response = await changeMode(owner.cookie, "agency")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      organisation: {
        organisationId: owner.organisationId,
        workspaceMode: "agency",
      },
      changed: true,
      refiledLocations: 0,
    })
    expect(await shape(owner.organisationId)).toEqual({
      mode: "agency",
      homeId: null,
      activeClients: 1,
    })
    const [kept] = await admin<{ clientId: string }[]>`
      select client_id::text as "clientId" from location where id = ${location}
    `
    expect(kept.clientId).toBe(before.homeId)

    const listed = await request("/api/clients", owner.cookie)
    const clients = (await listed.json()) as { items: { id: string }[] }
    expect(clients.items.map((client) => client.id)).toContain(before.homeId)

    const session = await (await request("/api/session", owner.cookie)).json()
    expect(session.session.workspaceMode).toBe("agency")

    const audits = await modeAudits(owner.organisationId)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorUserId: owner.userId,
      metadata: {
        previousMode: "business",
        workspaceMode: "agency",
        homeClientId: before.homeId,
        refiledLocations: 0,
      },
    })

    // The demoted client can now be archived like any other.
    const archive = await request(
      `/api/clients/${before.homeId}`,
      owner.cookie,
      {
        method: "PATCH",
        body: JSON.stringify({ archived: true, detachLocations: true }),
      }
    )
    expect(archive.status).toBe(200)
  })

  it("refuses agency to business while more than one client is active", async () => {
    const owner = await fixture()
    await seedClient(owner.organisationId, "Crown")
    await seedClient(owner.organisationId, "Bell")
    const response = await changeMode(owner.cookie, "business")
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "workspace_mode_too_many_clients",
    })
    expect(await shape(owner.organisationId)).toMatchObject({
      mode: "agency",
      homeId: null,
      activeClients: 2,
    })
    expect(await modeAudits(owner.organisationId)).toEqual([])
  })

  it("makes the sole active client the home and refiles every other location under it", async () => {
    const owner = await fixture()
    const sole = await seedClient(owner.organisationId, "Crown")
    const archived = await seedClient(owner.organisationId, "Old", true)
    const filed = await seedLocation(owner.organisationId, "Filed", sole)
    const loose = await seedLocation(owner.organisationId, "Loose")
    const stranded = await seedLocation(
      owner.organisationId,
      "Stranded",
      archived
    )

    const response = await changeMode(owner.cookie, "business")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      changed: true,
      refiledLocations: 2,
    })
    expect(await shape(owner.organisationId)).toEqual({
      mode: "business",
      homeId: sole,
      activeClients: 1,
    })
    const rows = await admin<{ id: string; clientId: string }[]>`
      select id::text as id, client_id::text as "clientId"
      from location
      where id in ${admin([filed, loose, stranded])}
    `
    expect(rows.every((row) => row.clientId === sole)).toBe(true)
    expect((await modeAudits(owner.organisationId))[0]?.metadata).toMatchObject(
      { previousMode: "agency", workspaceMode: "business", homeClientId: sole }
    )

    // Back in business mode the usual single-client rules hold, including
    // for the archived client and for writers that bypass the routes.
    const restore = await request(`/api/clients/${archived}`, owner.cookie, {
      method: "PATCH",
      body: JSON.stringify({ archived: false }),
    })
    expect(restore.status).toBe(409)
    expect(await restore.json()).toMatchObject({
      error: "business_mode_single_client",
    })
    await expect(
      seedClient(owner.organisationId, "Sneaky")
    ).rejects.toMatchObject({ code: "23514" })
  })

  it("creates a home client for an agency with no active client", async () => {
    const owner = await fixture()
    const archived = await seedClient(
      owner.organisationId,
      "Harness tenant",
      true
    )
    await seedLocation(owner.organisationId, "Loose")

    const response = await changeMode(owner.cookie, "business")
    expect(response.status).toBe(200)
    const after = await shape(owner.organisationId)
    expect(after.mode).toBe("business")
    expect(after.activeClients).toBe(1)
    expect(after.homeId).not.toBeNull()
    expect(after.homeId).not.toBe(archived)
    const [home] = await admin<{ name: string }[]>`
      select name from client where id = ${after.homeId}
    `
    // The organisation's own name was taken by the archived client.
    expect(home.name).toBe("Harness tenant (business)")
    const [unassigned] = await admin<{ count: number }[]>`
      select count(*)::int as count from location
      where organisation_id = ${owner.organisationId}
        and client_id is distinct from ${after.homeId}
    `
    expect(unassigned.count).toBe(0)
  })

  it("changes nothing and writes no audit row for the current mode", async () => {
    const owner = await fixture({ workspaceMode: "business" })
    const response = await changeMode(owner.cookie, "business")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      changed: false,
      refiledLocations: 0,
    })
    expect(await modeAudits(owner.organisationId)).toEqual([])
  })

  async function seedReportShare(
    organisationId: string,
    clientId: string,
    state: "live" | "revoked" | "expired" = "live"
  ) {
    const id = randomUUID()
    const tokenHash = randomUUID().replace(/-/g, "").padEnd(64, "0")
    await admin`
      insert into report_share (
        id, organisation_id, client_id, token_hash, created_at, expires_at,
        revoked_at
      )
      values (
        ${id},
        ${organisationId},
        ${clientId},
        ${tokenHash},
        now() - interval '2 days',
        ${state === "expired" ? admin`now() - interval '1 day'` : admin`now() + interval '30 days'`},
        ${state === "revoked" ? new Date() : null}
      )
    `
    return id
  }

  it("refuses to widen live report shares until the owner confirms, and records them", async () => {
    const owner = await fixture()
    const sole = await seedClient(owner.organisationId, "Crown")
    const live = await seedReportShare(owner.organisationId, sole)
    await seedReportShare(owner.organisationId, sole, "revoked")
    await seedReportShare(owner.organisationId, sole, "expired")
    const archived = await seedClient(owner.organisationId, "Former", true)
    const loose = await seedLocation(owner.organisationId, "Loose")
    const stranded = await seedLocation(
      owner.organisationId,
      "Stranded",
      archived
    )

    const refused = await changeMode(owner.cookie, "business")
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({
      error: "workspace_mode_report_shares",
      details: { locationsToRefile: 2, activeReportShares: 1 },
    })
    expect(await shape(owner.organisationId)).toMatchObject({
      mode: "agency",
      homeId: null,
    })
    const untouched = await admin<{ clientId: string | null }[]>`
      select client_id::text as "clientId" from location
      where id in ${admin([loose, stranded])}
      order by name
    `
    expect(untouched.map((row) => row.clientId)).toEqual([null, archived])
    expect(await modeAudits(owner.organisationId)).toEqual([])

    const confirmed = await request("/api/organisations", owner.cookie, {
      method: "PATCH",
      body: JSON.stringify({
        workspaceMode: "business",
        confirmReportShares: true,
      }),
    })
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toMatchObject({
      changed: true,
      refiledLocations: 2,
    })
    expect((await modeAudits(owner.organisationId))[0]?.metadata).toMatchObject(
      {
        workspaceMode: "business",
        homeClientId: sole,
        refiledLocations: 2,
        reportShareIds: [live],
      }
    )
  })

  it("does not ask about report shares when nothing would be refiled", async () => {
    const owner = await fixture()
    const sole = await seedClient(owner.organisationId, "Crown")
    await seedReportShare(owner.organisationId, sole)
    await seedLocation(owner.organisationId, "Filed", sole)
    const response = await changeMode(owner.cookie, "business")
    expect(response.status).toBe(200)
    expect((await modeAudits(owner.organisationId))[0]?.metadata).toMatchObject(
      { refiledLocations: 0, reportShareIds: [] }
    )
  })

  /**
   * Holds the sole client's row so the real switch (PATCH, runtime role)
   * stops after taking the organisation FOR UPDATE, runs `compete` while it
   * waits, and lets it finish once the competing write is queued behind it.
   */
  async function raceTheSwitch(
    owner: { organisationId: string; cookie: string },
    sole: string,
    compete: () => Promise<unknown>
  ) {
    const blocker = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const waitingOn = async (pid: number) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const [row] = await admin<{ pid: number | null }[]>`
          select min(pid) as pid from pg_stat_activity
          where ${pid}::int = any(pg_blocking_pids(pid))
        `
        if (row?.pid) return row.pid
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error(`nothing queued behind backend ${pid}`)
    }
    try {
      let switched: Promise<Response> | undefined
      let competing: Promise<unknown> | undefined
      await blocker.begin(async (sql) => {
        const [{ pid }] = await sql<{ pid: number }[]>`
          select pg_backend_pid() as pid
        `
        await sql`select 1 from client where id = ${sole} for update`
        switched = changeMode(owner.cookie, "business")
        const switchPid = await waitingOn(pid)
        competing = compete()
        await waitingOn(switchPid)
      })
      return { switched: await switched!, competing: await competing }
    } finally {
      await blocker.end()
    }
  }

  it("serialises a client create through the route against the real switch to business", async () => {
    const owner = await fixture()
    const sole = await seedClient(owner.organisationId, "Crown")
    const { switched, competing } = await raceTheSwitch(owner, sole, () =>
      request("/api/clients", owner.cookie, {
        method: "POST",
        body: JSON.stringify({ name: "Racer" }),
      })
    )
    expect(switched.status).toBe(200)
    const created = competing as Response
    expect(created.status).toBe(409)
    expect(await created.json()).toMatchObject({
      error: "business_mode_single_client",
    })
    expect(await shape(owner.organisationId)).toEqual({
      mode: "business",
      homeId: sole,
      activeClients: 1,
    })
  })

  it("files a location inserted during the switch under the home client", async () => {
    const owner = await fixture()
    const sole = await seedClient(owner.organisationId, "Crown")
    const racer = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const id = randomUUID()
    try {
      // postgres.js queries are lazy; execute() sends it now.
      const { switched } = await raceTheSwitch(owner, sole, () =>
        racer`
          insert into location (id, organisation_id, name)
          values (${id}, ${owner.organisationId}, 'Racer')
        `.execute()
      )
      expect(switched.status).toBe(200)
    } finally {
      await racer.end()
    }
    const [row] = await admin<{ clientId: string | null }[]>`
      select client_id::text as "clientId" from location where id = ${id}
    `
    expect(row.clientId).toBe(sole)

    // Afterwards every write is held to the home client: no client means
    // the home one, and any other client is refused.
    const later = await seedLocation(owner.organisationId, "Later")
    const [filed] = await admin<{ clientId: string }[]>`
      select client_id::text as "clientId" from location where id = ${later}
    `
    expect(filed.clientId).toBe(sole)
    const archived = await seedClient(owner.organisationId, "Old", true)
    await expect(
      seedLocation(owner.organisationId, "Elsewhere", archived)
    ).rejects.toMatchObject({ code: "23514" })
  })
})
