import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET, HEAD } from "@/app/r/[code]/route"
import {
  recordReviewLinkClick,
  resolveReviewLink,
  takeReviewLinkBudget,
  type ResolvedReviewLink,
} from "@/lib/server/review-links"

// The public review link, /r/<code>: no session, a 302 to Google's review
// form for a live code (counting one open unless it is a bot, a prefetch or a
// HEAD), one venue-free page for anything else, and a per-IP budget: over
// it, a live code still redirects uncounted and anything else gets a 429. The
// server module is mocked; its DB-backed behaviour is tested elsewhere.

// after() needs a request scope; here the deferred work runs straight away.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    void task()
  },
}))

vi.mock("@/lib/server/review-links", () => ({
  resolveReviewLink: vi.fn(),
  recordReviewLinkClick: vi.fn(),
  takeReviewLinkBudget: vi.fn(),
}))

const APP = "https://app.example.test"
const CODE = "abcdefghjk"
const ORG = "00000000-0000-4000-8000-000000000001"
const LINK_ID = "22222222-2222-4222-8222-222222222222"
const LOCATION_NAME = "The Corner House"
const TARGET =
  "https://search.google.com/local/writereview?placeid=ChIJcornerhouse"

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

const link: ResolvedReviewLink = {
  linkId: LINK_ID,
  organisationId: ORG,
  targetUri: TARGET,
}

function request(
  query = "",
  init: RequestInit & { userAgent?: string | null } = {}
): Request {
  const { userAgent = IPHONE, ...rest } = init
  const headers = new Headers(rest.headers)
  if (userAgent !== null) headers.set("user-agent", userAgent)
  return new Request(`${APP}/r/${CODE}${query}`, { ...rest, headers })
}

const context = (code = CODE) => ({ params: Promise.resolve({ code }) })

const get = (query = "", userAgent: string | null = IPHONE) =>
  GET(request(query, { userAgent }), context())

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(takeReviewLinkBudget).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  })
  vi.mocked(resolveReviewLink).mockResolvedValue(link)
  vi.mocked(recordReviewLinkClick).mockResolvedValue(undefined)
})

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("x-robots-tag")).toContain("noindex")
}

describe("a live code", () => {
  it("redirects (302) to the review form and counts one open", async () => {
    const response = await get()
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(TARGET)
    expectPrivateHeaders(response)
    expect(resolveReviewLink).toHaveBeenCalledWith(CODE)
    expect(recordReviewLinkClick).toHaveBeenCalledTimes(1)
    expect(recordReviewLinkClick).toHaveBeenCalledWith(link, "link")
  })

  it("records a QR scan when ?s=qr", async () => {
    await get("?s=qr")
    expect(recordReviewLinkClick).toHaveBeenCalledTimes(1)
    expect(recordReviewLinkClick).toHaveBeenCalledWith(link, "qr")
  })

  it.each(["?s=QR", "?s=email", "?s=", "?s=qr2", "?source=qr"])(
    "records any other source (%s) as a plain link open",
    async (query) => {
      const response = await get(query)
      expect(response.status).toBe(302)
      expect(recordReviewLinkClick).toHaveBeenCalledWith(link, "link")
    }
  )
})

describe("an unknown or switched-off code", () => {
  beforeEach(() => {
    vi.mocked(resolveReviewLink).mockResolvedValue(null)
  })

  it("answers one plain 404 page that names no venue", async () => {
    const response = await get()
    expect(response.status).toBe(404)
    expect(response.headers.get("content-type")).toMatch(/^text\/html/)
    expect(response.headers.get("location")).toBeNull()
    expectPrivateHeaders(response)
    const body = await response.text()
    expect(body).toContain("This review link isn’t working any more")
    for (const venueData of [
      TARGET,
      "writereview",
      ORG,
      LINK_ID,
      LOCATION_NAME,
    ])
      expect(body).not.toContain(venueData)
    expect(body).not.toContain(CODE)
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
  })

  it("is byte-identical for an unknown code and a disabled one", async () => {
    // From the route's view both resolve to null; the page must not differ.
    const unknown = await GET(request(), context("zzzzzzzzzz"))
    const disabled = await GET(request("?s=qr"), context(CODE))
    expect(unknown.status).toBe(404)
    expect(disabled.status).toBe(404)
    expect(await disabled.text()).toBe(await unknown.text())
  })

  it("counts nothing on HEAD either", async () => {
    const response = await HEAD(
      request("", { method: "HEAD" }),
      context("zzzzzzzzzz")
    )
    expect(response.status).toBe(404)
    expect(response.headers.get("location")).toBeNull()
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
  })
})

describe("the per-IP budget", () => {
  beforeEach(() => {
    vi.mocked(takeReviewLinkBudget).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
    })
  })

  it("still redirects a live code, but doesn't count the open", async () => {
    const response = await get()
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(TARGET)
    expect(takeReviewLinkBudget).toHaveBeenCalledTimes(1)
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
  })

  it("answers an unknown code with 429 and Retry-After, naming no venue", async () => {
    vi.mocked(resolveReviewLink).mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("120")
    expect(response.headers.get("content-type")).toMatch(/^text\/html/)
    expect(response.headers.get("location")).toBeNull()
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
    const body = await response.text()
    expect(body).toContain("Please try again in a few minutes")
    expect(body).not.toContain(TARGET)
    expect(body).not.toContain(ORG)
  })
})

describe("prefetches", () => {
  it.each([
    [{ "sec-purpose": "prefetch" }],
    [{ "sec-purpose": "prefetch;prerender" }],
    [{ purpose: "prefetch" }],
    [{ "next-router-prefetch": "1" }],
  ])("redirects without counting %j", async (headers) => {
    const response = await GET(request("", { headers }), context())
    expect(response.status).toBe(302)
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
  })
})

describe("bots and link previews", () => {
  it.each([
    ["facebookexternalhit/1.1"],
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
    [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    ],
    ["WhatsApp/2.23.20.0"],
    ["curl/8.4.0"],
  ])("still redirects %s but counts nothing", async (userAgent) => {
    const response = await get("", userAgent)
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(TARGET)
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
  })

  it("treats a missing user agent as a bot", async () => {
    const response = await get("?s=qr", null)
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(TARGET)
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
  })

  it("counts a guest's iPhone Safari", async () => {
    await get("", IPHONE)
    expect(recordReviewLinkClick).toHaveBeenCalledTimes(1)
  })
})

describe("HEAD", () => {
  it("resolves a live code to the same redirect but counts nothing", async () => {
    const response = await HEAD(request("?s=qr", { method: "HEAD" }), context())
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(TARGET)
    expectPrivateHeaders(response)
    expect(recordReviewLinkClick).not.toHaveBeenCalled()
  })
})

describe("no session", () => {
  it("answers outside any request scope, with no cookie and no session mock", async () => {
    // next/headers' cookies() throws outside a Next request scope, so the
    // route answering here shows it reads neither cookies nor a session.
    const { cookies } = await import("next/headers")
    await expect(async () => cookies()).rejects.toThrow()

    const route = await import("@/app/r/[code]/route")
    const response = await route.GET(
      new Request(`${APP}/r/${CODE}`, { headers: { "user-agent": IPHONE } }),
      context()
    )
    expect(response.status).toBe(302)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(recordReviewLinkClick).toHaveBeenCalledWith(link, "link")
  })
})
