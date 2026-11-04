import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { session, bootstrap, redirect } = vi.hoisted(() => ({
  session: vi.fn(),
  bootstrap: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { target })
  }),
}))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/lib/server/session", () => ({
  getSession: session,
  isLocalBootstrapEnabled: bootstrap,
}))

import RootPage from "@/app/page"

async function target() {
  try {
    await RootPage()
  } catch (error) {
    return (error as { target?: string }).target
  }
  throw new Error("the root page rendered instead of redirecting")
}

describe("/ is a redirect, never a page", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production")
    bootstrap.mockReturnValue(false)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it("sends a signed-in person to the Inbox", async () => {
    session.mockResolvedValue({ role: "owner" })
    expect(await target()).toBe("/inbox")
  })

  it("sends a signed-out visitor in production to sign-in, with no ?next=", async () => {
    session.mockResolvedValue(null)
    expect(await target()).toBe("/sign-in")
  })

  it("lets a local bootstrap open the Inbox without a session", async () => {
    session.mockResolvedValue(null)
    bootstrap.mockReturnValue(true)
    expect(await target()).toBe("/inbox")
  })

  it("lets development open the Inbox without a session", async () => {
    vi.stubEnv("NODE_ENV", "development")
    session.mockResolvedValue(null)
    expect(await target()).toBe("/inbox")
  })
})
