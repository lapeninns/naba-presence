import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/notifications/evaluate", () => ({
  queueDeliveries: vi.fn(async () => 0),
}))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { isRatingDrop } = await import("@/lib/server/review-rating-alerts")

describe("isRatingDrop", () => {
  it.each([
    [5, 2, true],
    [4, 3, true],
    [null, 2, true],
    [3, 2, false],
    [5, 4, false],
    [5, null, false],
    [null, null, false],
  ] as const)("(%s, %s) is %s", (previous, next, expected) => {
    expect(isRatingDrop(previous, next)).toBe(expected)
  })
})
