import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CSV_URL_LIFETIME_MS, downloadCsv } from "@/lib/reporting/csv"

describe("downloadCsv object URL lifetime", () => {
  let created: string[]
  let revoked: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    created = []
    revoked = []
    let n = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test/${++n}`
      created.push(url)
      return url
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revoked.push(url)
    })
    // jsdom does not navigate; the click itself is not under test.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  })

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"))
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("keeps the URL alive long enough for iOS Safari to read it", () => {
    downloadCsv("report.csv", [["a", 1]])
    expect(created).toHaveLength(1)

    vi.advanceTimersByTime(0)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(CSV_URL_LIFETIME_MS - 1)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(1)
    expect(revoked).toEqual(created)
  })

  it("does not cut short an earlier download when another starts", () => {
    downloadCsv("one.csv", [["a"]])
    vi.advanceTimersByTime(10_000)
    downloadCsv("two.csv", [["b"]])
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(CSV_URL_LIFETIME_MS - 10_000)
    expect(revoked).toEqual([created[0]])
    vi.advanceTimersByTime(10_000)
    expect(revoked).toEqual(created)
  })

  it("frees every held URL when the page is left", () => {
    downloadCsv("one.csv", [["a"]])
    downloadCsv("two.csv", [["b"]])
    window.dispatchEvent(new Event("pagehide"))
    expect(revoked.sort()).toEqual([...created].sort())
    // Nothing is revoked twice once the timers come due.
    vi.advanceTimersByTime(CSV_URL_LIFETIME_MS)
    expect(revoked).toHaveLength(2)
  })
})
