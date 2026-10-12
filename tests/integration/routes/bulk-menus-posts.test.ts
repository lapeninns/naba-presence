import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  bulkOperationResponseSchema,
  type BulkOperationView,
} from "@/lib/contracts/bulk-listings"
import { menuNodes } from "@/lib/domain/food-menus"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const CRON = { authorization: "Bearer route-harness-cron-secret" }

type Menus = Array<Record<string, unknown>>
type Listing = {
  menus: Menus
  canHaveFoodMenus: boolean
  /** The next menu PATCH answers 503 (applied or not), and reads fail until cleared. */
  lostResponse?: "landed" | "not_landed"
  readsFail?: boolean
  /** Menu PATCHes are refused outright (400): definitely not applied. */
  reject?: boolean
  /** Food Menus reads wait this long before answering. */
  readDelayMs?: number
}

const label = (displayName: string) => [{ displayName }]
const item = (name: string, units = "5") => ({
  labels: label(name),
  attributes: { price: { currencyCode: "GBP", units } },
})
const lunch = (soupPrice = "5"): Menus => [
  {
    labels: label("Lunch"),
    sections: [
      {
        labels: label("Starters"),
        items: [item("Soup", soupPrice), item("Bread", "3")],
      },
      { labels: label("Mains"), items: [item("Pie", "14")] },
    ],
  },
]
const UNAVAILABLE = { status: 503, json: { error: { status: "UNAVAILABLE" } } }

/** The stub listing a Google path belongs to (`locations/stub-…`). */
const listingOf = (path: string) =>
  /locations\/stub-[^/?]+/.exec(path)?.[0] ?? ""

/**
 * P09-R6 through real routes and the real job tick: Food Menus by full
 * replacement or by stable node ID (removals listed, never matched by
 * label), sent through the menu editor's pipeline with receipts and
 * recovery, and posts as independent local drafts that are published
 * separately.
 */
describeDatabase("bulk menus and post drafts", { timeout: 60_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const listings = new Map<string, Listing>()
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      PUBLISH_ENABLED: "true",
      JOBS_ENABLED: "true",
      GBP_FOOD_MENUS_ENABLED: "true",
      GBP_POSTS_ENABLED: "true",
    })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  beforeEach(() => {
    listings.clear()
    google.reset()
    google.respond({ method: "PATCH", pathIncludes: "/foodMenus" }, (call) => {
      const state = listings.get(listingOf(call.path))
      if (!state) return { status: 404, json: {} }
      if (state.reject)
        return {
          status: 400,
          json: { error: { code: 400, status: "INVALID_ARGUMENT" } },
        }
      const lost = state.lostResponse
      if (lost !== "not_landed")
        state.menus = (call.body as { menus: Menus }).menus
      if (lost) {
        state.lostResponse = undefined
        state.readsFail = true
        return UNAVAILABLE
      }
      return { status: 200, json: { menus: state.menus } }
    })
    // One GET handler: the Food Menus read carries a readMask too.
    google.respond(
      { method: "GET", pathIncludes: "locations/stub-" },
      async (call) => {
        const name = listingOf(call.path)
        const state = listings.get(name)
        if (!state) return { status: 404, json: {} }
        if (state.readsFail) return UNAVAILABLE
        if (call.path.includes("/foodMenus")) {
          if (state.readDelayMs)
            await new Promise((resolve) =>
              setTimeout(resolve, state.readDelayMs)
            )
          return { status: 200, json: { menus: state.menus } }
        }
        return {
          status: 200,
          json: {
            name,
            metadata: { canHaveFoodMenus: state.canHaveFoodMenus },
          },
        }
      }
    )
  })

  const menuPatches = (name?: string) =>
    google.calls.filter(
      (call) =>
        call.method === "PATCH" &&
        call.path.includes("/foodMenus") &&
        (!name || call.path.includes(name))
    )
  const tick = async () => {
    const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }

  async function tenant(count: number) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    await admin`
      insert into organisation_feature (organisation_id, feature, enabled, changed_by)
      values (${owner.organisationId}, 'bulk_actions', true, 'test')`
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked: Awaited<ReturnType<typeof seedLinkedLocation>>[] = []
    for (let index = 0; index < count; index += 1) {
      const location = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        ...connection,
      })
      listings.set(location.googleLocationName, {
        menus: lunch(),
        canHaveFoodMenus: true,
      })
      linked.push(location)
    }
    const api = (path: string, body?: unknown, cookie = owner.cookie) =>
      fetch(`${server.baseUrl}/api/listings/bulk${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const read = async (response: Response) => {
      expect(response.status, await response.clone().text()).toBeLessThan(300)
      return bulkOperationResponseSchema.parse(await response.json()).operation
    }
    const preview = async (
      items: unknown[],
      ids = linked,
      cookie = owner.cookie
    ) =>
      read(
        await api(
          "/preview",
          { locationIds: ids.map((entry) => entry.locationId), items },
          cookie
        )
      )
    const run = async (op: BulkOperationView, acknowledgeSkipped = false) => {
      await read(
        await api(`/${op.id}/approve`, {
          expectedPreviewHash: op.previewHash,
          acknowledgeSkipped,
        })
      )
      expect((await api(`/${op.id}/execute`, {})).status).toBe(202)
    }
    const status = async (op: BulkOperationView) => read(await api(`/${op.id}`))
    const receipt = async (id: string) => {
      const response = await fetch(`${server.baseUrl}/api/mutations/${id}`, {
        headers: { cookie: owner.cookie },
      })
      expect(response.status).toBe(200)
      return ((await response.json()) as { operation: Record<string, unknown> })
        .operation
    }
    const menusApi = async (locationId: string) => {
      const response = await fetch(
        `${server.baseUrl}/api/locations/${locationId}/food-menus`,
        { headers: { cookie: owner.cookie } }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return (
        (await response.json()) as {
          foodMenus: {
            canonicalResource: { revision: string }
            canonicalMenus: Menus
            canonicalHash: string
            googleHash: string
            status: string
          }
        }
      ).foodMenus
    }
    /** An editor save of the listing's menus (unpublished). */
    const saveMenus = async (locationId: string, menus: Menus) => {
      const current = await menusApi(locationId)
      const response = await fetch(
        `${server.baseUrl}/api/locations/${locationId}/food-menus`,
        {
          method: "PUT",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: JSON.stringify({
            expectedCanonicalRevision: current.canonicalResource.revision,
            menus,
          }),
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
    }
    const childOf = (op: BulkOperationView, index: number) =>
      op.children.find(
        (child) => child.locationId === linked[index].locationId
      )!
    return {
      owner,
      linked,
      api,
      preview,
      run,
      status,
      receipt,
      menusApi,
      saveMenus,
      childOf,
    }
  }

  /** The node ID the preview's merge names, read from a listing's menus. */
  function nodeIdOf(menus: Menus, name: string) {
    return menuNodes(menus).find(
      (ref) =>
        (ref.node.labels as Array<{ displayName: string }>)[0]?.displayName ===
        name
    )!.id
  }

  it("merges menu nodes by stable ID, lists removals, never matches by label, and publishes through the menu pipeline", async () => {
    const t = await tenant(4)
    const [a, b, c, d] = t.linked.map((l) => l.googleLocationName)
    // B has a soup of the same name at another price: not the same node.
    listings.get(b)!.menus = lunch("7")
    // C cannot have menus; D has an unpublished menu edit saved locally.
    listings.get(c)!.canHaveFoodMenus = false
    const dState = await t.menusApi(t.linked[3].locationId)
    const savedEdit = await fetch(
      `${server.baseUrl}/api/locations/${t.linked[3].locationId}/food-menus`,
      {
        method: "PUT",
        headers: { cookie: t.owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          expectedCanonicalRevision: dState.canonicalResource.revision,
          menus: [...lunch(), { labels: label("Dinner") }],
        }),
      }
    )
    expect(savedEdit.status, await savedEdit.clone().text()).toBe(200)
    const soup = nodeIdOf(lunch(), "Soup")
    const bread = nodeIdOf(lunch(), "Bread")
    const mains = nodeIdOf(lunch(), "Mains")
    const op = await t.preview([
      {
        operation: "food_menus",
        mode: "merge",
        changes: [
          {
            action: "update",
            nodeId: soup,
            fields: {
              attributes: { price: { currencyCode: "GBP", units: "6" } },
            },
          },
          { action: "remove", nodeId: bread },
          {
            action: "add",
            kind: "item",
            parentId: mains,
            node: item("Fish", "15"),
          },
        ],
      },
    ])
    expect(t.childOf(op, 0)).toMatchObject({
      eligibility: "eligible",
      updateMask: ["menus"],
      proposedValue: {
        removed: [
          { kind: "item", label: "Bread", within: ["Lunch", "Starters"] },
        ],
        added: [{ kind: "item", label: "Fish" }],
        updated: [{ label: "Soup", fields: ["attributes"] }],
        counts: { menus: 1, sections: 2, items: 3 },
      },
    })
    expect(t.childOf(op, 1)).toMatchObject({
      eligibility: "skipped",
      skipReason: "menu_node_not_found",
    })
    expect(t.childOf(op, 2)).toMatchObject({
      eligibility: "skipped",
      skipReason: "food_menus_not_eligible",
    })
    expect(t.childOf(op, 3)).toMatchObject({
      eligibility: "skipped",
      skipReason: "food_menus_local_changes",
    })
    // The preview is read only.
    expect(menuPatches()).toHaveLength(0)
    await t.run(op, true)
    await tick()
    const after = await t.status(op)
    expect(after.status).toBe("completed")
    const child = t.childOf(after, 0)
    expect(child).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
    })
    expect(listings.get(a)!.menus).toEqual([
      {
        labels: label("Lunch"),
        sections: [
          { labels: label("Starters"), items: [item("Soup", "6")] },
          {
            labels: label("Mains"),
            items: [item("Pie", "14"), item("Fish", "15")],
          },
        ],
      },
    ])
    expect(menuPatches(a)).toHaveLength(1)
    expect(menuPatches(b)).toHaveLength(0)
    expect(menuPatches(d)).toHaveLength(0)
    expect(await t.receipt(child.mutationOperationId!)).toMatchObject({
      surface: "food_menus",
      outcome: "confirmed_applied",
    })
    const [approval] = await admin<{ approvalRef: string }[]>`
      select approval_ref as "approvalRef" from mutation_operation where id = ${child.mutationOperationId!}`
    expect(approval.approvalRef).toBe(`bulk_listing_operation:${op.id}`)
    // The saved menus moved with Google: the editor shows them in sync.
    const saved = await t.menusApi(t.linked[0].locationId)
    expect(saved.status).toBe("in_sync")
    expect(saved.canonicalMenus).toEqual(listings.get(a)!.menus)
    // D's local edit is untouched.
    expect((await t.menusApi(t.linked[3].locationId)).canonicalMenus).toEqual([
      ...lunch(),
      { labels: label("Dinner") },
    ])
  })

  it("replaces menus in full, and turns a Google change after the preview into a conflict with nothing sent", async () => {
    const t = await tenant(2)
    const [a, b] = t.linked.map((l) => l.googleLocationName)
    const next: Menus = [
      {
        labels: label("Lunch"),
        sections: [
          {
            labels: label("Starters"),
            items: [item("Soup"), item("Bread", "3")],
          },
        ],
      },
    ]
    const op = await t.preview([
      { operation: "food_menus", mode: "replace", menus: next },
    ])
    for (const index of [0, 1])
      expect(t.childOf(op, index).proposedValue).toMatchObject({
        removed: [
          { kind: "section", label: "Mains", within: ["Lunch"], contains: 1 },
        ],
        added: [],
      })
    await t.run(op)
    // B's menus change on Google before the child runs.
    listings.get(b)!.menus = lunch("9")
    await tick()
    const after = await t.status(op)
    expect(after.status).toBe("completed_with_failures")
    expect(t.childOf(after, 0)).toMatchObject({ status: "succeeded" })
    expect(t.childOf(after, 1)).toMatchObject({
      status: "conflict",
      resultCode: "google_baseline_changed",
    })
    expect(listings.get(a)!.menus).toEqual(next)
    expect(listings.get(b)!.menus).toEqual(lunch("9"))
    expect(menuPatches(b)).toHaveLength(0)
  })

  for (const lost of ["landed", "not_landed"] as const) {
    it(`leaves a lost menu response to recovery and never resends it (${lost})`, async () => {
      const t = await tenant(1)
      const name = t.linked[0].googleLocationName
      listings.get(name)!.lostResponse = lost
      const next = [{ labels: label("Brunch") }]
      const op = await t.preview([
        { operation: "food_menus", mode: "replace", menus: next },
      ])
      await t.run(op)
      await tick()
      const [unresolved] = (await t.status(op)).children
      expect(unresolved.status).toBe("ambiguous")
      expect(unresolved.mutationOperationId).not.toBeNull()
      // Retry leaves it to recovery.
      await t.api(`/${op.id}/retry`, {})
      listings.get(name)!.readsFail = false
      await admin`update mutation_operation set next_recovery_at = now() - interval '1 second'
        where id = ${unresolved.mutationOperationId!}`
      await tick()
      await tick()
      const [settled] = (await t.status(op)).children
      expect(menuPatches(name)).toHaveLength(1)
      const saved = await t.menusApi(t.linked[0].locationId)
      if (lost === "landed") {
        expect(settled).toMatchObject({ status: "succeeded" })
        expect(listings.get(name)!.menus).toEqual(next)
        expect(saved.canonicalMenus).toEqual(next)
      } else {
        expect(settled.status).toBe("failed")
        expect(settled.resultCode).toMatch(/^recovered_not_applied/)
        // The saved menus are put back to what they were before the batch.
        expect(listings.get(name)!.menus).toEqual(lunch())
        expect(saved.canonicalMenus).toEqual(lunch())
      }
    })
  }

  it("settles each dispatch-time menu state: already applied, an editor's edit made after the preview, and a refused write", async () => {
    const t = await tenant(4)
    const [a, b, , d] = t.linked.map((l) => l.googleLocationName)
    const next: Menus = [{ labels: label("Brunch") }]
    const op = await t.preview([
      { operation: "food_menus", mode: "replace", menus: next },
    ])
    expect(op.children.every((child) => child.eligibility === "eligible")).toBe(
      true
    )
    await t.run(op)
    // A: Google already shows the result; the saved menus are untouched.
    listings.get(a)!.menus = next
    // B: Google already shows the result, but an editor then saved a
    // further, unpublished edit. It must never be overwritten.
    listings.get(b)!.menus = next
    const draft: Menus = [...next, { labels: label("Dinner") }]
    await t.saveMenus(t.linked[1].locationId, draft)
    // C: an unpublished editor edit made after the preview; Google unchanged.
    await t.saveMenus(t.linked[2].locationId, [...lunch(), ...draft])
    // D: Google refuses the write outright.
    listings.get(d)!.reject = true
    await tick()
    const after = await t.status(op)
    expect(t.childOf(after, 0)).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
    })
    expect(t.childOf(after, 1)).toMatchObject({
      status: "conflict",
      resultCode: "food_menus_local_changes",
    })
    expect(t.childOf(after, 2)).toMatchObject({
      status: "conflict",
      resultCode: "food_menus_local_changes",
    })
    expect(t.childOf(after, 3).status).toBe("failed")
    // Only D was sent, once.
    expect(menuPatches()).toHaveLength(1)
    expect(menuPatches(d)).toHaveLength(1)
    const saved = await Promise.all(
      t.linked.map((l) => t.menusApi(l.locationId))
    )
    expect(saved[0].canonicalMenus).toEqual(next)
    expect(saved[0].status).toBe("in_sync")
    expect(saved[1].canonicalMenus).toEqual(draft)
    expect(saved[2].canonicalMenus).toEqual([...lunch(), ...draft])
    // The refused write put D's saved menus back.
    expect(saved[3].canonicalMenus).toEqual(lunch())
    expect(listings.get(d)!.menus).toEqual(lunch())
  })

  for (const ending of ["rejected", "not_landed"] as const) {
    it(`keeps a restore point when a re-claim finds its own earlier save (${ending})`, async () => {
      const t = await tenant(1)
      const [linked] = t.linked
      const name = linked.googleLocationName
      const next: Menus = [{ labels: label("Brunch") }]
      const op = await t.preview([
        { operation: "food_menus", mode: "replace", menus: next },
      ])
      await t.run(op)
      // An earlier claim saved the result, then stopped before a receipt;
      // the re-claim cleared its restore point.
      await t.saveMenus(linked.locationId, next)
      if (ending === "rejected") listings.get(name)!.reject = true
      else listings.get(name)!.lostResponse = "not_landed"
      await tick()
      if (ending === "not_landed") {
        const [unresolved] = (await t.status(op)).children
        expect(unresolved.status).toBe("ambiguous")
        listings.get(name)!.readsFail = false
        await admin`update mutation_operation set next_recovery_at = now() - interval '1 second'
          where id = ${unresolved.mutationOperationId!}`
        await tick()
        await tick()
      }
      const [settled] = (await t.status(op)).children
      expect(settled.status).toBe("failed")
      expect(menuPatches(name)).toHaveLength(1)
      expect(listings.get(name)!.menus).toEqual(lunch())
      // The saved menus are back to what Google showed at the preview.
      const saved = await t.menusApi(linked.locationId)
      expect(saved.canonicalMenus).toEqual(lunch())
      expect(saved.status).toBe("in_sync")
    })
  }

  it("expires a child whose dispatch window closes while it reads Google, with nothing saved or sent", async () => {
    const t = await tenant(1)
    const [linked] = t.linked
    const name = linked.googleLocationName
    const op = await t.preview([
      {
        operation: "food_menus",
        mode: "replace",
        menus: [{ labels: label("Brunch") }],
      },
    ])
    await t.run(op)
    const before = await t.menusApi(linked.locationId)
    // The window closes during the dispatch's own Google read.
    await admin`update bulk_listing_operation set dispatch_expires_at = now() + interval '3 seconds'
      where id = ${op.id}`
    listings.get(name)!.readDelayMs = 4_500
    await tick()
    listings.get(name)!.readDelayMs = undefined
    const [child] = (await t.status(op)).children
    expect(child.status).toBe("expired")
    expect(menuPatches(name)).toHaveLength(0)
    const saved = await t.menusApi(linked.locationId)
    expect(saved.canonicalResource.revision).toBe(
      before.canonicalResource.revision
    )
    expect(saved.canonicalMenus).toEqual(lunch())
  })

  it("publishes the menu editor's change under the Food Menus lock bulk children take", async () => {
    const t = await tenant(1)
    const [linked] = t.linked
    const root = `${server.baseUrl}/api/locations/${linked.locationId}/food-menus`
    const initial = await t.menusApi(linked.locationId)
    const edited = [{ labels: label("Supper") }]
    const put = await fetch(root, {
      method: "PUT",
      headers: { cookie: t.owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        expectedCanonicalRevision: initial.canonicalResource.revision,
        menus: edited,
      }),
    })
    expect(put.status, await put.clone().text()).toBe(200)
    const reviewed = await t.menusApi(linked.locationId)
    const key = `${t.owner.organisationId}:${linked.locationId}:food_menus`
    const holder = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked!: () => void
    const held = new Promise<void>((resolve) => {
      locked = resolve
    })
    const holding = holder.begin(async (lock) => {
      await lock`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      locked()
      await released
    })
    try {
      await held
      let settled = false
      const publishing = fetch(root, {
        method: "POST",
        headers: {
          cookie: t.owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          confirmation: "publish_nabapresence_food_menus_to_google",
          expectedCanonicalRevision: reviewed.canonicalResource.revision,
          expectedCanonicalHash: reviewed.canonicalHash,
          expectedGoogleHash: reviewed.googleHash,
          confirmFullReplacement: true,
        }),
      }).then((response) => {
        settled = true
        return response
      })
      try {
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        expect(settled).toBe(false)
        expect(menuPatches()).toHaveLength(0)
      } finally {
        release()
        await holding
      }
      const published = await publishing
      expect(published.status, await published.clone().text()).toBe(200)
      expect(listings.get(linked.googleLocationName)!.menus).toEqual(edited)
    } finally {
      release()
      await holder.end()
    }
  })

  it("creates one independent draft per listing, authored by the requester, and publishes nothing", async () => {
    const t = await tenant(2)
    await admin`update organisation set require_two_person_approval = true where id = ${t.owner.organisationId}`
    const manager = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      canPublish: true,
    })
    await admin`update member set role = 'admin' where user_id = ${manager.userId}`
    const draft = {
      operation: "post_draft",
      post: { topicType: "STANDARD", summary: "Quiz night on Thursday" },
    }
    const op = await t.preview([draft], t.linked, manager.cookie)
    expect(op.children.map((child) => child.proposedValue)).toEqual([
      {
        topicType: "STANDARD",
        languageCode: "en-GB",
        summary: "Quiz night on Thursday",
      },
      {
        topicType: "STANDARD",
        languageCode: "en-GB",
        summary: "Quiz night on Thursday",
      },
    ])
    await t.run(op)
    await tick()
    const after = await t.status(op)
    expect(after.status).toBe("completed")
    const posts = await admin<
      { id: string; locationId: string; status: string; createdBy: string }[]
    >`
      select id::text as id, location_id::text as "locationId", status, created_by::text as "createdBy"
      from gbp_local_post where organisation_id = ${t.owner.organisationId} order by location_id`
    expect(posts).toHaveLength(2)
    expect(new Set(posts.map((post) => post.locationId))).toEqual(
      new Set(t.linked.map((l) => l.locationId))
    )
    for (const post of posts) {
      expect(post.status).toBe("draft")
      expect(post.createdBy).toBe(manager.userId)
    }
    const links = await admin<{ postId: string }[]>`
      select local_post_id::text as "postId" from bulk_listing_child where operation_id = ${op.id}`
    expect(new Set(links.map((row) => row.postId))).toEqual(
      new Set(posts.map((post) => post.id))
    )
    // A re-run of a child (a crashed tick) finds its draft: no second one.
    await admin`update bulk_listing_child set status = 'queued', next_attempt_at = now(), finished_at = null
      where operation_id = ${op.id}`
    await admin`update bulk_listing_operation set status = 'running' where id = ${op.id}`
    await tick()
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from gbp_local_post where organisation_id = ${t.owner.organisationId}`
    expect(count).toBe(2)
    // Nothing went to Google.
    expect(
      google.calls.filter((call) => call.path.includes("localPosts"))
    ).toHaveLength(0)
    // Publication is its own approval: the author (the requester) cannot
    // publish their draft under two-person approval; it waits for another.
    const [first] = posts
    const publish = await fetch(
      `${server.baseUrl}/api/locations/${first.locationId}/posts/${first.id}/publish`,
      {
        method: "POST",
        headers: { cookie: manager.cookie, "content-type": "application/json" },
        body: JSON.stringify({}),
      }
    )
    expect(publish.status, await publish.clone().text()).toBeLessThan(300)
    const [state] = await admin<{ status: string }[]>`
      select status from gbp_local_post where id = ${first.id}`
    expect(state.status).toBe("awaiting_approval")
    expect(
      google.calls.filter((call) => call.path.includes("localPosts"))
    ).toHaveLength(0)
  })

  it("holds the new families to the table's checks", async () => {
    const t = await tenant(1)
    const op = await t.preview([
      { operation: "food_menus", mode: "replace", menus: [] },
    ])
    const [child] = await admin<{ id: string; resourceKey: string }[]>`
      select id::text as id, resource_key as "resourceKey" from bulk_listing_child where operation_id = ${op.id}`
    expect(child.resourceKey).toBe("food_menus")
    await expect(
      admin`update bulk_listing_child set resource_key = 'photos' where id = ${child.id}`
    ).rejects.toMatchObject({ code: "23514" })
    // A draft must belong to the child's own organisation.
    const other = await createTestTenant(admin)
    organisations.push(other.organisationId)
    const otherConnection = await seedGoogleConnection(admin, {
      organisationId: other.organisationId,
    })
    const otherLocation = await seedLinkedLocation(admin, {
      organisationId: other.organisationId,
      ...otherConnection,
    })
    const [foreign] = await admin<{ id: string }[]>`
      insert into gbp_local_post (organisation_id, location_id, external_location_id, topic_type, language_code, summary, media)
      values (${other.organisationId}, ${otherLocation.locationId}, ${otherLocation.externalLocationId}, 'STANDARD', 'en-GB', 'x', '[]'::jsonb)
      returning id::text as id`
    await expect(
      admin`update bulk_listing_child set local_post_id = ${foreign.id} where id = ${child.id}`
    ).rejects.toMatchObject({ code: "23503" })
  })
})
