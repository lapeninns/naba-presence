import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("Google Place Actions", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PLACE_ACTIONS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("lists, creates, stale-checks, updates, deletes, and audits links", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    let links: Array<Record<string, unknown>> = [
      {
        name: `${linked.googleLocationName}/placeActionLinks/aggregator`,
        providerType: "AGGREGATOR_3P",
        isEditable: false,
        uri: "https://aggregator.example.com/old-crown",
        placeActionType: "DINING_RESERVATION",
        isPreferred: false,
        createTime: "2026-07-01T10:00:00Z",
        updateTime: "2026-07-01T10:00:00Z",
      },
    ]

    google.respond(
      { method: "GET", pathIncludes: "/placeActionLinks" },
      () => ({ status: 200, json: { placeActionLinks: links } })
    )
    google.respond(
      { method: "POST", pathIncludes: "/placeActionLinks" },
      (call) => {
        const created = {
          name: `${linked.googleLocationName}/placeActionLinks/merchant`,
          providerType: "MERCHANT",
          isEditable: true,
          ...(call.body as Record<string, unknown>),
          createTime: "2026-07-31T10:00:00Z",
          updateTime: "2026-07-31T10:00:00Z",
        }
        links.push(created)
        return { status: 200, json: created }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: "/placeActionLinks/merchant" },
      () => ({
        status: 200,
        json: links.find((link) => String(link.name).endsWith("/merchant")),
      })
    )
    google.respond(
      { method: "PATCH", pathIncludes: "/placeActionLinks/merchant" },
      (call) => {
        const body = call.body as Record<string, unknown>
        links = links.map((link) =>
          String(link.name).endsWith("/merchant")
            ? {
                ...link,
                uri: body.uri,
                placeActionType: body.placeActionType,
                isPreferred: body.isPreferred,
                updateTime: "2026-07-31T11:00:00Z",
              }
            : link
        )
        return {
          status: 200,
          json: links.find((link) => String(link.name).endsWith("/merchant")),
        }
      }
    )
    google.respond(
      { method: "DELETE", pathIncludes: "/placeActionLinks/merchant" },
      () => {
        links = links.filter((link) => !String(link.name).endsWith("/merchant"))
        return { status: 200, json: {} }
      }
    )

    const base = `${server.baseUrl}/api/locations/${linked.locationId}/place-actions`
    const initial = await fetch(base, { headers: { cookie: owner.cookie } })
    expect(initial.status, await initial.clone().text()).toBe(200)
    expect((await initial.json()).placeActions).toMatchObject({
      writesEnabled: true,
      links: [{ providerType: "AGGREGATOR_3P", isEditable: false }],
    })

    const create = await fetch(base, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "create-link"),
      body: JSON.stringify({
        confirmation: "create_google_place_action",
        uri: "https://book.example.com/old-crown",
        placeActionType: "DINING_RESERVATION",
        isPreferred: true,
      }),
    })
    expect(create.status, await create.clone().text()).toBe(201)
    expect(await create.json()).toMatchObject({
      status: "succeeded",
      idempotent: false,
    })

    const afterCreate = await fetch(base, {
      headers: { cookie: owner.cookie },
    })
    const merchant = (await afterCreate.json()).placeActions.links.find(
      (link: { providerType: string }) => link.providerType === "MERCHANT"
    )
    expect(merchant).toMatchObject({
      uri: "https://book.example.com/old-crown",
      isPreferred: true,
      isEditable: true,
    })

    const stale = await fetch(`${base}/${merchant.id}`, {
      method: "PATCH",
      headers: jsonHeaders(owner.cookie, "stale-link"),
      body: JSON.stringify({
        confirmation: "update_google_place_action",
        uri: "https://book.example.com/new",
        placeActionType: "DINING_RESERVATION",
        isPreferred: true,
        expectedGoogleHash: "0".repeat(64),
      }),
    })
    expect(stale.status).toBe(409)

    const update = await fetch(`${base}/${merchant.id}`, {
      method: "PATCH",
      headers: jsonHeaders(owner.cookie, "update-link"),
      body: JSON.stringify({
        confirmation: "update_google_place_action",
        uri: "https://book.example.com/new",
        placeActionType: "DINING_RESERVATION",
        isPreferred: false,
        expectedGoogleHash: merchant.googleHash,
      }),
    })
    expect(update.status, await update.clone().text()).toBe(200)
    expect(await update.json()).toMatchObject({ status: "succeeded" })

    const afterUpdate = await fetch(base, {
      headers: { cookie: owner.cookie },
    })
    const updatedMerchant = (await afterUpdate.json()).placeActions.links.find(
      (link: { providerType: string }) => link.providerType === "MERCHANT"
    )
    expect(updatedMerchant).toMatchObject({
      uri: "https://book.example.com/new",
      isPreferred: false,
    })

    const remove = await fetch(`${base}/${merchant.id}`, {
      method: "DELETE",
      headers: jsonHeaders(owner.cookie, "delete-link"),
      body: JSON.stringify({
        confirmation: "delete_google_place_action",
        expectedGoogleHash: updatedMerchant.googleHash,
      }),
    })
    expect(remove.status, await remove.clone().text()).toBe(200)
    expect(await remove.json()).toMatchObject({ status: "succeeded" })

    const final = await fetch(base, { headers: { cookie: owner.cookie } })
    expect((await final.json()).placeActions.links).toHaveLength(1)

    const [ledger] = await admin<{ count: string }[]>`
      select count(*)::text as count
      from place_action_mutation
      where organisation_id = ${owner.organisationId}
        and status = 'succeeded'
    `
    expect(Number(ledger.count)).toBe(3)
    const [audit] = await admin<{ count: string }[]>`
      select count(*)::text as count
      from audit_log
      where organisation_id = ${owner.organisationId}
        and action in (
          'place_action.created',
          'place_action.updated',
          'place_action.deleted'
        )
    `
    expect(Number(audit.count)).toBe(3)
  }, 30_000)
})

function jsonHeaders(cookie: string, requestId: string) {
  return {
    cookie,
    "content-type": "application/json",
    "x-request-id": requestId,
  }
}
