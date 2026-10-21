import { describe, expect, it, vi } from "vitest"

import {
  PAUSE_CACHE_TTL_MS,
  createPauseReader,
  pauseCacheTtlMs,
} from "@/lib/server/pause-controls"

// The integration harness boots the app with PAUSE_CACHE_TTL_MS=0 so its
// suites need not sleep out the cache (NP1-005). Production must keep 5 s.
describe("pause cache TTL", () => {
  it("caches a production snapshot for exactly 5 s", async () => {
    expect(PAUSE_CACHE_TTL_MS).toBe(5_000)
    expect(pauseCacheTtlMs({})).toBe(5_000)
    let clock = 0
    const load = vi.fn(async () => ["publish"])
    const reader = createPauseReader({
      load,
      ttlMs: pauseCacheTtlMs({ VERCEL: "1", PAUSE_CACHE_TTL_MS: "0" }),
      now: () => clock,
    })
    await reader.read()
    clock = 4_999
    await reader.read()
    expect(load).toHaveBeenCalledTimes(1)
    clock = 5_000
    await reader.read()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["0", 0],
    ["50", 50],
    ["5000", 5_000],
  ])("lets the test-only variable shorten it to %s ms", (value, expected) => {
    expect(pauseCacheTtlMs({ PAUSE_CACHE_TTL_MS: value })).toBe(expected)
  })

  it.each(["5001", "9999", "60000", "-1", "1e3", "0.5", " 5", "abc", ""])(
    "never lengthens it or reads %j as anything but the default",
    (value) => {
      expect(pauseCacheTtlMs({ PAUSE_CACHE_TTL_MS: value })).toBe(5_000)
    }
  )

  it("ignores the variable on any Vercel deployment", () => {
    expect(pauseCacheTtlMs({ VERCEL: "1", PAUSE_CACHE_TTL_MS: "0" })).toBe(
      5_000
    )
  })

  it("reads every time with a zero TTL", async () => {
    const load = vi.fn(async () => [])
    const reader = createPauseReader({
      load,
      ttlMs: pauseCacheTtlMs({ PAUSE_CACHE_TTL_MS: "0" }),
      now: () => 0,
    })
    await reader.read()
    await reader.read()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
