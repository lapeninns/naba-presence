import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The retired flat routes' pages, end to end through flatRouteTarget: each
 * one's segment and `moved` word, the forwarded query, and sign-in first in
 * production. Visibility (which locations count) is resolvePrimaryLocation's.
 */

const primary = vi.hoisted(() => ({
  current: { locationCount: 2, locationId: null as string | null },
}))
vi.mock("@/lib/server/primary-location", () => ({
  resolvePrimaryLocation: async () => primary.current,
}))
const auth = vi.hoisted(() => ({
  signedIn: true,
  requested: null as string | null,
}))
vi.mock("@/lib/server/session", () => ({
  getSession: async () => (auth.signedIn ? { userId: "user-1" } : null),
  isLocalBootstrapEnabled: () => false,
}))
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      auth.requested ? { "x-naba-request-path": auth.requested } : {}
    ),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("redirect"), { url })
  },
}))

type Query = Record<string, string | string[] | undefined>
type FlatPage = (props: {
  params: Promise<{ section: string[] }>
  searchParams: Promise<Query>
}) => Promise<never>

async function landing(
  page: FlatPage,
  searchParams: Query = {},
  section: string[] = []
): Promise<string> {
  try {
    await page({
      params: Promise.resolve({ section }),
      searchParams: Promise.resolve(searchParams),
    })
  } catch (error) {
    return (error as { url: string }).url
  }
  throw new Error("page did not redirect")
}

const ONE = { locationCount: 1, locationId: "loc-1" }
const QUERY = { clientId: "c-1", locationId: "loc-1", section: "hours" }
const FORWARDED = "clientId=c-1&locationId=loc-1&section=hours"

beforeEach(() => {
  primary.current = { locationCount: 2, locationId: null }
  auth.signedIn = true
  auth.requested = null
  vi.unstubAllEnvs()
})

function signedOutInProduction(requested: string) {
  vi.stubEnv("NODE_ENV", "production")
  auth.signedIn = false
  auth.requested = requested
}

describe("R07 /photos", async () => {
  const { default: page } = await import("@/app/photos/page")
  const photos = page as unknown as FlatPage

  it("goes to the one listing's photos with the query", async () => {
    primary.current = ONE
    expect(await landing(photos, QUERY)).toBe(
      `/listings/loc-1/photos?${FORWARDED}`
    )
  })

  it("lands several or no listings on Clients with moved=photos", async () => {
    expect(await landing(photos, QUERY)).toBe(
      `/clients?${FORWARDED}&moved=photos`
    )
    primary.current = { locationCount: 0, locationId: null }
    expect(await landing(photos)).toBe("/clients?moved=photos")
  })

  it("asks a signed-out visitor to sign in and come back", async () => {
    signedOutInProduction("/photos?clientId=c-1")
    expect(await landing(photos, { clientId: "c-1" })).toBe(
      "/sign-in?next=%2Fphotos%3FclientId%3Dc-1"
    )
  })
})

describe("R08 /posts", async () => {
  const { default: page } = await import("@/app/posts/page")
  const posts = page as unknown as FlatPage

  it("goes to the one listing's posts with the query", async () => {
    primary.current = ONE
    expect(await landing(posts, QUERY)).toBe(
      `/listings/loc-1/posts?${FORWARDED}`
    )
  })

  it("lands several listings on Clients with moved=posts", async () => {
    expect(await landing(posts, QUERY)).toBe(
      `/clients?${FORWARDED}&moved=posts`
    )
  })

  it("asks a signed-out visitor to sign in and come back", async () => {
    signedOutInProduction("/posts")
    expect(await landing(posts)).toBe("/sign-in?next=%2Fposts")
  })
})

describe("R10 /profile", async () => {
  const { default: page } = await import("@/app/profile/page")
  const profile = page as unknown as FlatPage

  it("goes to the one listing's overview, not its profile editor", async () => {
    primary.current = ONE
    expect(await landing(profile, QUERY)).toBe(`/listings/loc-1?${FORWARDED}`)
    expect(await landing(profile)).toBe("/listings/loc-1")
  })

  it("lands several listings on Clients with moved=profile", async () => {
    expect(await landing(profile, QUERY)).toBe(
      `/clients?${FORWARDED}&moved=profile`
    )
  })

  it("asks a signed-out visitor to sign in and come back", async () => {
    signedOutInProduction("/profile?section=hours")
    expect(await landing(profile, { section: "hours" })).toBe(
      "/sign-in?next=%2Fprofile%3Fsection%3Dhours"
    )
  })
})

describe("R11 /profile/[...section]", async () => {
  const { existsSync } = await import("node:fs")
  const { FLAT_SEGMENT_MAP } = await import("@/lib/server/flat-route-redirect")
  const { default: page } = await import("@/app/profile/[...section]/page")
  const section = page as unknown as FlatPage

  it("maps the old section onto the listing area, keeping the query", async () => {
    primary.current = ONE
    expect(await landing(section, QUERY, ["hours"])).toBe(
      `/listings/loc-1/hours?${FORWARDED}`
    )
    expect(await landing(section, {}, ["details"])).toBe(
      "/listings/loc-1/profile"
    )
  })

  it("reads only the first segment and sends unknown ones to the overview", async () => {
    primary.current = ONE
    expect(await landing(section, {}, ["photos", "extra", "more"])).toBe(
      "/listings/loc-1/photos"
    )
    expect(await landing(section, {}, ["nope"])).toBe("/listings/loc-1")
    expect(await landing(section, {}, ["constructor"])).toBe("/listings/loc-1")
  })

  it("lands several listings on Clients with moved=profile", async () => {
    expect(await landing(section, QUERY, ["hours"])).toBe(
      `/clients?${FORWARDED}&moved=profile`
    )
  })

  it("asks a signed-out visitor to sign in and come back to the subpath", async () => {
    signedOutInProduction("/profile/hours?clientId=c-1")
    expect(await landing(section, { clientId: "c-1" }, ["hours"])).toBe(
      "/sign-in?next=%2Fprofile%2Fhours%3FclientId%3Dc-1"
    )
  })

  it("only names listing areas that exist", () => {
    for (const area of new Set(Object.values(FLAT_SEGMENT_MAP))) {
      const dir = `app/(dashboard)/listings/[id]/${area}`
      expect(existsSync(`${dir}/page.tsx`), dir).toBe(true)
    }
  })
})
