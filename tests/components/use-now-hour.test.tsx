import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useNow, useNowHour } from "@/lib/time/server-now"

afterEach(() => vi.useRealTimers())

const HOUR = 3_600_000

// W5-02: the inbox read the 15 s clock to the millisecond, so the whole
// tree — list, rows, review — re-rendered four times a minute for a value it
// only used to the hour.
describe("useNowHour", () => {
  it("re-renders on the hour, not on every tick of the shared clock", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-14T10:00:10Z"))
    let hourRenders = 0
    let nowRenders = 0
    const hour = renderHook(() => {
      hourRenders += 1
      return useNowHour()
    })
    // A millisecond reader beside it, so the tick is known to be running.
    renderHook(() => {
      nowRenders += 1
      return useNow()
    })
    expect(hour.result.current).toBe(Date.parse("2026-10-14T10:00:00Z"))
    const settledHour = hourRenders
    const settledNow = nowRenders

    act(() => vi.advanceTimersByTime(4 * 15_000))
    expect(nowRenders).toBeGreaterThan(settledNow)
    expect(hourRenders).toBe(settledHour)

    act(() => vi.advanceTimersByTime(HOUR))
    expect(hour.result.current).toBe(Date.parse("2026-10-14T11:00:00Z"))
    expect(hourRenders).toBe(settledHour + 1)
  })
})
