import { beforeEach, describe, expect, it, vi } from "vitest"

const redirect = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("server-only", () => ({}))

import { redirectOutOfClientLayer } from "@/lib/server/workspace-redirect"

beforeEach(() => redirect.mockReset())

describe("redirectOutOfClientLayer", () => {
  it("sends a business out of every client page", () => {
    const business = { workspaceMode: "business" as const }
    redirectOutOfClientLayer(business, "/clients")
    redirectOutOfClientLayer(business, "/clients/new")
    redirectOutOfClientLayer(business, "/clients/0f1e")
    redirectOutOfClientLayer(business, "/clients/0f1e/settings")
    expect(redirect.mock.calls.map(([to]) => to)).toEqual([
      "/listings",
      "/listings",
      "/listings",
      "/settings",
    ])
  })

  it("lets an agency, and a missing session, through", () => {
    redirectOutOfClientLayer({ workspaceMode: "agency" }, "/clients")
    redirectOutOfClientLayer(null, "/clients/0f1e/settings")
    expect(redirect).not.toHaveBeenCalled()
  })

  it("ignores paths that are not the client layer", () => {
    redirectOutOfClientLayer({ workspaceMode: "business" }, "/listings")
    expect(redirect).not.toHaveBeenCalled()
  })
})
