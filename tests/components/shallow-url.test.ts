import { afterEach, describe, expect, it, vi } from "vitest"

import { pushUrl, replaceUrl } from "@/lib/navigation/shallow-url"

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, "", "/")
})

// Next patches these two methods so useSearchParams follows them without a
// server render; the router state goes on the entry through that patch, so
// the helpers hand it no state of their own.
describe("shallow URL writes", () => {
  it("rewrites the current entry through history.replaceState", () => {
    const replace = vi.spyOn(window.history, "replaceState")
    const push = vi.spyOn(window.history, "pushState")
    const length = window.history.length
    replaceUrl("/inbox?selected=rev-2")
    expect(replace).toHaveBeenCalledWith(null, "", "/inbox?selected=rev-2")
    expect(push).not.toHaveBeenCalled()
    expect(window.location.search).toBe("?selected=rev-2")
    expect(window.history.length).toBe(length)
  })

  it("adds an entry through history.pushState", () => {
    const push = vi.spyOn(window.history, "pushState")
    const length = window.history.length
    pushUrl("/inbox?selected=rev-3")
    expect(push).toHaveBeenCalledWith(null, "", "/inbox?selected=rev-3")
    expect(window.location.search).toBe("?selected=rev-3")
    expect(window.history.length).toBe(length + 1)
  })
})
