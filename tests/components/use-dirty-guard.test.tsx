import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { __resetDraftSources, stashAllDrafts, takeStashedDraft } from "@/lib/api/draft-stash"

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe("useDirtyGuard", () => {
  it("stashes the snapshot only while dirty", () => {
    const { rerender } = renderHook(
      ({ dirty, text }: { dirty: boolean; text: string }) =>
        useDirtyGuard({ key: "inbox:reply:rev-1", isDirty: dirty, snapshot: () => text }),
      { initialProps: { dirty: false, text: "hello" } }
    )
    stashAllDrafts()
    expect(takeStashedDraft("inbox:reply:rev-1")).toBeNull()

    rerender({ dirty: true, text: "hello" })
    stashAllDrafts()
    expect(takeStashedDraft("inbox:reply:rev-1")).toBe("hello")
  })

  it("confirmDiscard is true when clean and defers to window.confirm when dirty", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    const clean = renderHook(() =>
      useDirtyGuard({ key: "k", isDirty: false, snapshot: () => "x" })
    )
    expect(clean.result.current.confirmDiscard()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()

    const dirty = renderHook(() =>
      useDirtyGuard({ key: "k2", isDirty: true, snapshot: () => "x" })
    )
    expect(dirty.result.current.confirmDiscard()).toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
  })

  it("arms beforeunload while dirty and disarms when clean", () => {
    const { rerender, unmount } = renderHook(
      ({ dirty }: { dirty: boolean }) =>
        useDirtyGuard({ key: "k3", isDirty: dirty, snapshot: () => "x" }),
      { initialProps: { dirty: true } }
    )
    const dirtyEvent = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)

    rerender({ dirty: false })
    const cleanEvent = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)
    unmount()
  })

  it("restore returns and clears the stashed draft", () => {
    sessionStorage.setItem("naba:draft:inbox:reply:rev-9", "recovered")
    const { result } = renderHook(() =>
      useDirtyGuard({ key: "inbox:reply:rev-9", isDirty: false, snapshot: () => "" })
    )
    expect(result.current.restore()).toBe("recovered")
    expect(result.current.restore()).toBeNull()
  })
})
