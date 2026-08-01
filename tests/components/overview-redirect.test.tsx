import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

import OverviewPage from "@/app/(dashboard)/overview/page"
import { redirect } from "next/navigation"

describe("overview redirect page", () => {
  it("redirects to /home", () => {
    expect(() => OverviewPage()).toThrow()
    expect(redirect).toHaveBeenCalledWith("/home")
  })
})
