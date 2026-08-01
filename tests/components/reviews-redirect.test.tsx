import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

import ReviewsPage from "@/app/reviews/page"
import { redirect } from "next/navigation"

describe("reviews redirect page", () => {
  it("redirects a bare /reviews to /inbox", async () => {
    await expect(
      ReviewsPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow()
    expect(redirect).toHaveBeenCalledWith("/inbox")
  })

  it("forwards the query string (a bookmarked /reviews?queue=needs_reply)", async () => {
    vi.mocked(redirect).mockClear()
    await expect(
      ReviewsPage({ searchParams: Promise.resolve({ queue: "needs_reply", rating: "5" }) })
    ).rejects.toThrow()
    expect(redirect).toHaveBeenCalledWith("/inbox?queue=needs_reply&rating=5")
  })
})
