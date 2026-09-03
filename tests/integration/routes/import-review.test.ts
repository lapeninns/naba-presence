import { randomUUID } from "node:crypto"

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

describeDatabase("import review queue", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PROFILE_WRITES_ENABLED: "true",
      GBP_FOOD_MENUS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
      IMPORT_REVIEW_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("raises, supersedes, and decides Google-side menu and profile drift", async () => {
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

    let providerLocation: Record<string, unknown> = {
      name: linked.googleLocationName,
      title: "Old Crown",
      profile: { description: "Village pub" },
      phoneNumbers: { primaryPhone: "+44 1223 000000" },
      websiteUri: "https://old-crown.example",
      categories: { primaryCategory: { displayName: "Pub" } },
      metadata: { canHaveFoodMenus: true },
    }
    let providerMenus: Array<Record<string, unknown>> = []
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({ status: 200, json: providerLocation })
    )
    google.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({
      status: 200,
      json: { menus: providerMenus },
    }))
    google.respond({ method: "PATCH", pathIncludes: "/foodMenus" }, (call) => {
      providerMenus = (call.body as { menus: Array<Record<string, unknown>> })
        .menus
      return { status: 200, json: { menus: providerMenus } }
    })

    const root = `${server.baseUrl}/api/locations/${linked.locationId}`

    // Establish a published baseline so drift classification has anchors.
    const initialMenus = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    const canonicalMenus = [
      {
        labels: [{ displayName: "Main", languageCode: "en-GB" }],
        sections: [
          {
            labels: [{ displayName: "Mains", languageCode: "en-GB" }],
            items: [
              {
                labels: [{ displayName: "Steak pie", languageCode: "en-GB" }],
                attributes: {
                  price: { currencyCode: "GBP", units: "16", nanos: 0 },
                },
              },
            ],
          },
        ],
      },
    ]
    await putJson(`${root}/food-menus`, owner.cookie, "save-menus", {
      expectedCanonicalRevision: initialMenus.canonicalResource.revision,
      menus: canonicalMenus,
    })
    const reviewedMenus = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    const publish = await fetch(`${root}/food-menus`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-menus"),
      body: JSON.stringify({
        confirmation: "publish_nabapresence_food_menus_to_google",
        expectedCanonicalRevision: reviewedMenus.canonicalResource.revision,
        expectedCanonicalHash: reviewedMenus.canonicalHash,
        expectedGoogleHash: reviewedMenus.googleHash,
        confirmFullReplacement: true,
      }),
    })
    expect(publish.status, await publish.clone().text()).toBe(200)

    // A refresh while in sync raises nothing but pins identities.
    const inSyncRefresh = await postJson(
      `${root}/import-review/refresh`,
      owner.cookie,
      "refresh-in-sync",
      { resourceType: "food_menus" }
    )
    expect(inSyncRefresh.outcomes.foodMenus.skipped).toBe("in_sync")
    const pins = await admin<{ googlePath: string }[]>`
      select google_path as "googlePath" from food_menu_item_identity
      where location_id = ${linked.locationId}
    `
    expect(pins).toHaveLength(1)

    // Google-side edit: price change + a brand-new item.
    providerMenus = structuredClone(providerMenus)
    const section = (
      providerMenus[0].sections as Array<Record<string, unknown>>
    )[0]
    const items = section.items as Array<Record<string, unknown>>
    ;(items[0].attributes as { price: { units: string } }).price.units = "18"
    items.push({
      labels: [{ displayName: "Fish & chips", languageCode: "en-GB" }],
      attributes: { price: { currencyCode: "GBP", units: "14", nanos: 0 } },
    })

    const refreshed = await postJson(
      `${root}/import-review/refresh`,
      owner.cookie,
      "refresh-drift",
      { resourceType: "food_menus" }
    )
    expect(refreshed.outcomes.foodMenus.raised).toBe(2)

    const list = await getJson(
      `${root}/import-review?resourceType=food_menus`,
      owner.cookie,
      "proposals"
    )
    expect(list).toHaveLength(2)
    const changed = list.find(
      (row: { kind: string }) => row.kind === "item_changed"
    )
    const added = list.find(
      (row: { kind: string }) => row.kind === "item_added_on_google"
    )
    expect(changed.matchStatus).toBe("previous_identity")
    expect(added.itemLabel).toBe("Fish & chips")

    // A second refresh with Google unchanged leaves the open review alone.
    // Superseding and re-inserting per tick would 409 an Apply the user
    // started one tick earlier and resurrect anything already decided.
    const secondRefresh = await postJson(
      `${root}/import-review/refresh`,
      owner.cookie,
      "refresh-again",
      { resourceType: "food_menus" }
    )
    expect(secondRefresh.outcomes.foodMenus).toMatchObject({
      raised: 0,
      superseded: 0,
    })
    const superseded = await admin<{ count: string }[]>`
      select count(*)::text as count from presence_import_proposal
      where location_id = ${linked.locationId} and status = 'superseded'
    `
    expect(Number(superseded[0].count)).toBe(0)

    // Apply the price change.
    const fresh = await getJson(
      `${root}/import-review?resourceType=food_menus`,
      owner.cookie,
      "proposals"
    )
    expect(fresh.map((row: { id: string }) => row.id).sort()).toEqual(
      list.map((row: { id: string }) => row.id).sort()
    )
    const freshChanged = fresh.find(
      (row: { kind: string }) => row.kind === "item_changed"
    )
    const menusBefore = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    const decided = await postJson(
      `${root}/import-review/${freshChanged.id}/decision`,
      owner.cookie,
      "decide-apply",
      {
        action: "apply",
        confirmation: "import_google_food_menus_to_nabapresence",
        expectedCanonicalRevision: menusBefore.canonicalResource.revision,
      }
    )
    expect(decided.proposal.status).toBe("applied")
    const menusAfter = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    expect(Number(menusAfter.canonicalResource.revision)).toBe(
      Number(menusBefore.canonicalResource.revision) + 1
    )
    const pie = (
      (
        menusAfter.canonicalMenus[0].sections as Array<Record<string, unknown>>
      )[0].items as Array<{ attributes: { price: { units: string } } }>
    )[0]
    expect(pie.attributes.price.units).toBe("18")

    // Deciding the same proposal again conflicts.
    const again = await fetch(
      `${root}/import-review/${freshChanged.id}/decision`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie, "decide-twice"),
        body: JSON.stringify({
          action: "ignore",
          confirmation: "import_google_food_menus_to_nabapresence",
          expectedCanonicalRevision: menusAfter.canonicalResource.revision,
        }),
      }
    )
    expect(again.status).toBe(409)
    expect((await again.json()).error).toBe("proposal_not_pending")

    // Ignore the added item.
    const freshAdded = fresh.find(
      (row: { kind: string }) => row.kind === "item_added_on_google"
    )
    const ignored = await postJson(
      `${root}/import-review/${freshAdded.id}/decision`,
      owner.cookie,
      "decide-ignore",
      {
        action: "ignore",
        confirmation: "import_google_food_menus_to_nabapresence",
        expectedCanonicalRevision: menusAfter.canonicalResource.revision,
      }
    )
    expect(ignored.proposal.status).toBe("ignored")

    // A stale revision fails the decision and records the failure honestly.
    providerMenus = structuredClone(providerMenus)
    ;(
      (
        (providerMenus[0].sections as Array<Record<string, unknown>>)[0]
          .items as Array<Record<string, unknown>>
      )[0].attributes as {
        price: { units: string }
      }
    ).price.units = "19"
    await postJson(
      `${root}/import-review/refresh`,
      owner.cookie,
      "refresh-stale",
      { resourceType: "food_menus" }
    )
    const staleList = await getJson(
      `${root}/import-review?resourceType=food_menus`,
      owner.cookie,
      "proposals"
    )
    // Only the price moved on Google. The ignored "Fish & chips" suggestion
    // must not come back: Ignore holds until Google changes that item.
    expect(
      staleList.some(
        (row: { kind: string }) => row.kind === "item_added_on_google"
      )
    ).toBe(false)
    const staleRow = staleList.find(
      (row: { kind: string }) => row.kind === "item_changed"
    )
    const staleDecision = await fetch(
      `${root}/import-review/${staleRow.id}/decision`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie, "decide-stale"),
        body: JSON.stringify({
          action: "apply",
          confirmation: "import_google_food_menus_to_nabapresence",
          expectedCanonicalRevision: "1",
        }),
      }
    )
    expect(staleDecision.status).toBe(409)
    // An optimistic-lock miss wrote nothing, so the claim is released rather
    // than burned: the retry with a fresh revision finds the row pending. Only
    // outcomes a retry cannot fix leave a proposal `failed`.
    const releasedRow = await admin<
      { status: string; failureCode: string | null; decision: string | null }[]
    >`
      select status, failure_code as "failureCode", decision
      from presence_import_proposal where id = ${staleRow.id}
    `
    expect(releasedRow[0]).toMatchObject({
      status: "pending",
      failureCode: null,
      decision: null,
    })

    // Profile: Google-side rename raises a field proposal; apply imports it.
    await getJson(`${root}/profile`, owner.cookie, "profile") // establish per-field baselines
    providerLocation = { ...providerLocation, title: "The Old Crown" }
    const profileRefresh = await postJson(
      `${root}/import-review/refresh`,
      owner.cookie,
      "refresh-profile",
      { resourceType: "profile" }
    )
    expect(profileRefresh.outcomes.profile.raised).toBe(1)
    const profileRows = await getJson(
      `${root}/import-review?resourceType=profile`,
      owner.cookie,
      "proposals"
    )
    expect(profileRows[0]).toMatchObject({
      kind: "field_changed",
      fieldKey: "name",
    })
    const profileState = await getJson(
      `${root}/profile`,
      owner.cookie,
      "profile"
    )
    const applied = await postJson(
      `${root}/import-review/${profileRows[0].id}/decision`,
      owner.cookie,
      "decide-profile",
      {
        action: "apply",
        confirmation: "import_google_profile_to_nabapresence",
        expectedCanonicalRevision: profileState.canonicalResource.revision,
      }
    )
    expect(applied.proposal.status).toBe("applied")
    const profileAfter = await getJson(
      `${root}/profile`,
      owner.cookie,
      "profile"
    )
    expect(
      profileAfter.fields.find((field: { key: string }) => field.key === "name")
        .canonicalValue
    ).toBe("The Old Crown")

    // A mismatched confirmation literal is rejected before any claim.
    const wrongConfirmation = await fetch(
      `${root}/import-review/${freshAdded.id}/decision`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie, "decide-wrong-confirmation"),
        body: JSON.stringify({
          action: "ignore",
          confirmation: "import_google_profile_to_nabapresence",
          expectedCanonicalRevision: profileAfter.canonicalResource.revision,
        }),
      }
    )
    expect(wrongConfirmation.status).toBe(400)

    // The cron sweep raises proposals too (menu drift reintroduced above).
    // The sweep pages over every organisation in the database, so follow the
    // cursor until this tenant's outcome appears.
    let sweepOutcome: { resource: string; status: string } | undefined
    let cursor: string | null = null
    for (let page = 0; page < 20 && !sweepOutcome; page += 1) {
      const sweep = await fetch(
        `${server.baseUrl}/api/sync/presence-resources`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer route-harness-cron-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            maxOrganisations: 25,
            ...(cursor ? { organisationCursor: cursor } : {}),
          }),
        }
      )
      expect(sweep.status, await sweep.clone().text()).toBe(200)
      const body = (await sweep.json()) as {
        outcomes: Array<{
          organisationId: string
          resource: string
          status: string
        }>
        nextCursor: string | null
      }
      sweepOutcome = body.outcomes.find(
        (outcome) =>
          outcome.organisationId === owner.organisationId &&
          outcome.resource === "foodMenus"
      )
      if (!body.nextCursor) break
      cursor = body.nextCursor
    }
    expect(sweepOutcome?.status).toBe("succeeded")

    // Cross-tenant isolation: a second organisation sees none of it.
    const outsider = await createTestTenant(admin)
    organisations.push(outsider.organisationId)
    const foreign = await fetch(`${root}/import-review`, {
      headers: { cookie: outsider.cookie },
    })
    expect(foreign.status).toBe(404)
    const counts = await fetch(`${server.baseUrl}/api/import-review/counts`, {
      headers: { cookie: outsider.cookie },
    })
    expect(counts.status).toBe(200)
    expect((await counts.json()).counts).toEqual([])
  }, 60_000)

  /** An owner with one linked location, ready for menu and profile drift. */
  async function seedLocation() {
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
    return {
      owner,
      linked,
      root: `${server.baseUrl}/api/locations/${linked.locationId}`,
    }
  }

  function proposalRow(id: string) {
    return admin<
      {
        status: string
        decision: string | null
        failureCode: string | null
        decidedAt: Date | null
      }[]
    >`
      select status, decision, failure_code as "failureCode",
        decided_at as "decidedAt"
      from presence_import_proposal where id = ${id}
    `
  }

  /**
   * Walks the presence-resources sweep until `done` reports the tenant under
   * test has been visited. The sweep pages over every organisation in the
   * database, and this tenant can be anywhere in that order.
   */
  async function sweepUntil(done: () => Promise<boolean>) {
    let cursor: string | null = null
    for (let page = 0; page < 20; page += 1) {
      const sweep = await fetch(
        `${server.baseUrl}/api/sync/presence-resources`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer route-harness-cron-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            maxOrganisations: 25,
            ...(cursor ? { organisationCursor: cursor } : {}),
          }),
        }
      )
      expect(sweep.status, await sweep.clone().text()).toBe(200)
      const body = (await sweep.json()) as { nextCursor: string | null }
      if (await done()) return
      if (!body.nextCursor) return
      cursor = body.nextCursor
    }
  }

  it("fails only the proposals stranded past the reaper's window", async () => {
    const { owner, linked } = await seedLocation()
    const stranded = randomUUID()
    const inFlight = randomUUID()
    // Two claimed decisions on one location: one abandoned twenty minutes ago
    // by a crash between the claim and the settle, one claimed a moment ago by
    // a request that is still running. Until a stranded row leaves
    // `processing` the live-key index blocks every fresh proposal for its
    // identity, so the field is frozen for the user.
    // updated_at is set on the insert, not backdated afterwards: the table
    // carries a before-update trigger that would stamp now() over it.
    for (const seed of [
      {
        id: stranded,
        key: "name",
        updatedAt: new Date(Date.now() - 20 * 60_000),
      },
      { id: inFlight, key: "description", updatedAt: new Date() },
    ]) {
      await admin`
        insert into presence_import_proposal (
          id, organisation_id, location_id, external_location_id,
          resource_type, identity_key, kind, field_key, suggested_patch,
          status, decision, pinned_canonical_revision, pinned_canonical_hash,
          pinned_google_hash, batch_id, raised_via, updated_at
        ) values (
          ${seed.id}, ${owner.organisationId}, ${linked.locationId},
          ${linked.externalLocationId}, 'profile', ${seed.key},
          'field_changed', ${seed.key},
          ${admin.json({ op: "set_field", fieldKey: seed.key, value: "Google" })},
          'processing', 'apply', '1', 'pinned-canonical', 'pinned-google',
          ${randomUUID()}, 'manual', ${seed.updatedAt}
        )
      `
    }

    await sweepUntil(async () => {
      const [row] = await proposalRow(stranded)
      return row.status !== "processing"
    })

    const [settled] = await proposalRow(stranded)
    expect(settled).toMatchObject({
      status: "failed",
      failureCode: "proposal_apply_failed",
    })
    expect(settled.decidedAt).not.toBeNull()
    // The other half of the predicate: a decision seconds old is in flight,
    // not stranded. Reaping it would settle a proposal out from under the
    // request that claimed it and resurrect a decision already being applied.
    const [live] = await proposalRow(inFlight)
    expect(live.status).toBe("processing")
  }, 60_000)

  it("releases the claim when an overwrite needs confirming", async () => {
    const { owner, linked, root } = await seedLocation()
    let providerLocation: Record<string, unknown> = {
      name: linked.googleLocationName,
      title: "Harbour Cafe",
      profile: { description: "Seafront cafe" },
      phoneNumbers: { primaryPhone: "+44 1223 111111" },
      websiteUri: "https://harbour.example",
      categories: { primaryCategory: { displayName: "Cafe" } },
      metadata: { canHaveFoodMenus: false },
    }
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({ status: 200, json: providerLocation })
    )

    await getJson(`${root}/profile`, owner.cookie, "profile")
    providerLocation = { ...providerLocation, title: "The Harbour Cafe" }
    const refreshed = await postJson(
      `${root}/import-review/refresh`,
      owner.cookie,
      "refresh-conflict",
      { resourceType: "profile" }
    )
    expect(refreshed.outcomes.profile.raised).toBe(1)
    const [proposal] = await getJson(
      `${root}/import-review?resourceType=profile`,
      owner.cookie,
      "proposals"
    )

    // The user renames the location locally while the suggestion is open, so
    // Apply is no longer an import into an untouched field - it destroys a
    // local edit the proposal never saw.
    const before = await getJson(`${root}/profile`, owner.cookie, "profile")
    await putJson(`${root}/profile`, owner.cookie, "rename-locally", {
      expectedCanonicalRevision: before.canonicalResource.revision,
      values: { name: "Harbour Cafe & Bar" },
    })
    const edited = await getJson(`${root}/profile`, owner.cookie, "profile")

    const unconfirmed = await fetch(
      `${root}/import-review/${proposal.id}/decision`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie, "decide-unconfirmed"),
        body: JSON.stringify({
          action: "apply",
          confirmation: "import_google_profile_to_nabapresence",
          expectedCanonicalRevision: edited.canonicalResource.revision,
        }),
      }
    )
    expect(unconfirmed.status).toBe(409)
    expect((await unconfirmed.json()).error).toBe(
      "canonical_overwrite_confirmation_required"
    )
    // Nothing was written, so the claim is released rather than burned: the
    // acknowledged retry has to find the row pending, because `failed` is
    // terminal and the claim only accepts `pending`.
    const [released] = await proposalRow(proposal.id)
    expect(released).toMatchObject({
      status: "pending",
      decision: null,
      failureCode: null,
    })
    const stillEdited = await getJson(
      `${root}/profile`,
      owner.cookie,
      "profile"
    )
    expect(
      stillEdited.fields.find((field: { key: string }) => field.key === "name")
        .canonicalValue
    ).toBe("Harbour Cafe & Bar")

    const confirmed = await postJson(
      `${root}/import-review/${proposal.id}/decision`,
      owner.cookie,
      "decide-confirmed",
      {
        action: "apply",
        confirmation: "import_google_profile_to_nabapresence",
        expectedCanonicalRevision: edited.canonicalResource.revision,
        confirmOverwriteCanonicalChanges: true,
      }
    )
    expect(confirmed.proposal.status).toBe("applied")
    const applied = await getJson(`${root}/profile`, owner.cookie, "profile")
    expect(
      applied.fields.find((field: { key: string }) => field.key === "name")
        .canonicalValue
    ).toBe("The Harbour Cafe")
  }, 60_000)

  it("keeps or removes a local item Google no longer has", async () => {
    const { owner, linked, root } = await seedLocation()
    const providerLocation: Record<string, unknown> = {
      name: linked.googleLocationName,
      title: "The Anchor",
      profile: { description: "Riverside pub" },
      phoneNumbers: { primaryPhone: "+44 1223 222222" },
      websiteUri: "https://anchor.example",
      categories: { primaryCategory: { displayName: "Pub" } },
      metadata: { canHaveFoodMenus: true },
    }
    let providerMenus: Array<Record<string, unknown>> = []
    // Scoped to this location: an unscoped `/foodMenus` matcher would also
    // answer for the other tenants this suite seeds.
    const menusPath = `${linked.googleLocationName.replace("locations/", "")}/foodMenus`
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({ status: 200, json: providerLocation })
    )
    google.respond({ method: "GET", pathIncludes: menusPath }, () => ({
      status: 200,
      json: { menus: providerMenus },
    }))
    google.respond({ method: "PATCH", pathIncludes: menusPath }, (call) => {
      providerMenus = (call.body as { menus: Array<Record<string, unknown>> })
        .menus
      return { status: 200, json: { menus: providerMenus } }
    })

    const item = (label: string, units: string) => ({
      labels: [{ displayName: label, languageCode: "en-GB" }],
      attributes: { price: { currencyCode: "GBP", units, nanos: 0 } },
    })
    const initial = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    await putJson(`${root}/food-menus`, owner.cookie, "save-anchor-menus", {
      expectedCanonicalRevision: initial.canonicalResource.revision,
      menus: [
        {
          labels: [{ displayName: "Main", languageCode: "en-GB" }],
          sections: [
            {
              labels: [{ displayName: "Mains", languageCode: "en-GB" }],
              items: [
                item("Steak pie", "16"),
                item("Fish & chips", "14"),
                item("Ploughman's", "11"),
              ],
            },
          ],
        },
      ],
    })
    const reviewed = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    const publish = await fetch(`${root}/food-menus`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-anchor-menus"),
      body: JSON.stringify({
        confirmation: "publish_nabapresence_food_menus_to_google",
        expectedCanonicalRevision: reviewed.canonicalResource.revision,
        expectedCanonicalHash: reviewed.canonicalHash,
        expectedGoogleHash: reviewed.googleHash,
        confirmFullReplacement: true,
      }),
    })
    expect(publish.status, await publish.clone().text()).toBe(200)

    // Someone deletes two of the three items in the Google console. The
    // section survives, so each one is an item the local menu still has and
    // Google does not.
    providerMenus = structuredClone(providerMenus)
    const section = (
      providerMenus[0].sections as Array<Record<string, unknown>>
    )[0]
    section.items = (section.items as Array<Record<string, unknown>>).slice(
      0,
      1
    )

    const refreshed = await postJson(
      `${root}/import-review/refresh`,
      owner.cookie,
      "refresh-missing",
      { resourceType: "food_menus" }
    )
    expect(refreshed.outcomes.foodMenus.raised).toBe(2)
    const proposals = await getJson(
      `${root}/import-review?resourceType=food_menus`,
      owner.cookie,
      "proposals"
    )
    expect(
      proposals.every(
        (row: { kind: string }) => row.kind === "item_missing_from_google"
      )
    ).toBe(true)
    const keep = proposals.find(
      (row: { itemLabel: string }) => row.itemLabel === "Fish & chips"
    )
    const remove = proposals.find(
      (row: { itemLabel: string }) => row.itemLabel === "Ploughman's"
    )

    // Keep is a statement about Google, not about the menu: it settles the
    // suggestion and leaves canonical data alone.
    const menusBefore = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    const kept = await postJson(
      `${root}/import-review/${keep.id}/decision`,
      owner.cookie,
      "decide-keep-local",
      {
        action: "keep_local",
        confirmation: "import_google_food_menus_to_nabapresence",
        expectedCanonicalRevision: menusBefore.canonicalResource.revision,
      }
    )
    expect(kept.proposal.status).toBe("ignored")
    expect(kept.canonicalRevision).toBeNull()

    const removed = await postJson(
      `${root}/import-review/${remove.id}/decision`,
      owner.cookie,
      "decide-delete-local",
      {
        action: "delete_local",
        confirmation: "import_google_food_menus_to_nabapresence",
        expectedCanonicalRevision: menusBefore.canonicalResource.revision,
      }
    )
    expect(removed.proposal.status).toBe("applied")

    const menusAfter = await getJson(
      `${root}/food-menus`,
      owner.cookie,
      "foodMenus"
    )
    const labels = (
      (
        menusAfter.canonicalMenus[0].sections as Array<Record<string, unknown>>
      )[0].items as Array<{ labels: Array<{ displayName: string }> }>
    ).map((entry) => entry.labels[0].displayName)
    expect(labels).toEqual(["Steak pie", "Fish & chips"])
  }, 60_000)
})

describeDatabase("import review kill switch", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      PUBLISH_ENABLED: "true",
      IMPORT_REVIEW_ENABLED: "false",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("pauses refresh and decisions, and the list reports the flag", async () => {
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
    const root = `${server.baseUrl}/api/locations/${linked.locationId}`

    const refresh = await fetch(`${root}/import-review/refresh`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "refresh-disabled"),
      body: JSON.stringify({ resourceType: "all" }),
    })
    expect(refresh.status).toBe(503)
    expect((await refresh.json()).error).toBe("import_review_paused")

    const decision = await fetch(
      `${root}/import-review/00000000-0000-4000-8000-000000000000/decision`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie, "decide-disabled"),
        body: JSON.stringify({
          action: "ignore",
          confirmation: "import_google_food_menus_to_nabapresence",
          expectedCanonicalRevision: "1",
        }),
      }
    )
    expect(decision.status).toBe(503)
    expect((await decision.json()).error).toBe("import_review_paused")

    const list = await fetch(`${root}/import-review`, {
      headers: { cookie: owner.cookie },
    })
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      importReviewEnabled: false,
      proposals: [],
    })
  }, 30_000)
})

async function getJson(url: string, cookie: string, key: string) {
  const response = await fetch(url, { headers: { cookie } })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json())[key]
}

async function putJson(
  url: string,
  cookie: string,
  requestId: string,
  body: unknown
) {
  const response = await fetch(url, {
    method: "PUT",
    headers: jsonHeaders(cookie, requestId),
    body: JSON.stringify(body),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json()
}

async function postJson(
  url: string,
  cookie: string,
  requestId: string,
  body: unknown
) {
  const response = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(cookie, requestId),
    body: JSON.stringify(body),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json()
}

function jsonHeaders(cookie: string, requestId: string) {
  return {
    cookie,
    "content-type": "application/json",
    "x-request-id": requestId,
  }
}
