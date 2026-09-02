import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"

type Props = { initial: { name: string }; revision: number }

function renderReset(initialProps: Props) {
  return renderHook(
    ({ initial, revision }: Props) => useResetOnRevision(initial, revision),
    { initialProps }
  )
}

describe("useResetOnRevision", () => {
  it("seeds from the initial value and behaves like useState", () => {
    const { result } = renderReset({ initial: { name: "server" }, revision: 1 })
    expect(result.current[0]).toEqual({ name: "server" })

    act(() => result.current[1]({ name: "edited" }))
    expect(result.current[0]).toEqual({ name: "edited" })

    act(() => result.current[1]((prev) => ({ name: `${prev.name}!` })))
    expect(result.current[0]).toEqual({ name: "edited!" })
  })

  it("keeps local edits when the initial value re-renders under the same revision", () => {
    const { result, rerender } = renderReset({
      initial: { name: "server" },
      revision: 1,
    })
    act(() => result.current[1]({ name: "edited" }))

    // A new object with the same content (memo miss / identical refetch).
    rerender({ initial: { name: "server" }, revision: 1 })
    expect(result.current[0]).toEqual({ name: "edited" })
  })

  it("resets to the new initial value when the revision advances", () => {
    const { result, rerender } = renderReset({
      initial: { name: "server" },
      revision: 1,
    })
    act(() => result.current[1]({ name: "edited" }))

    rerender({ initial: { name: "server v2" }, revision: 2 })
    expect(result.current[0]).toEqual({ name: "server v2" })

    // And stays stable afterwards until the revision moves again.
    act(() => result.current[1]({ name: "edited again" }))
    rerender({ initial: { name: "server v2" }, revision: 2 })
    expect(result.current[0]).toEqual({ name: "edited again" })
  })

  it("accepts any revision token (hashes, strings) compared by value", () => {
    const { result, rerender } = renderHook(
      ({ initial, hash }: { initial: string; hash: string }) =>
        useResetOnRevision(initial, hash),
      { initialProps: { initial: "a", hash: "h1" } }
    )
    act(() => result.current[1]("typed"))
    rerender({ initial: "a", hash: "h1" })
    expect(result.current[0]).toBe("typed")
    rerender({ initial: "b", hash: "h2" })
    expect(result.current[0]).toBe("b")
  })
})
