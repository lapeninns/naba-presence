import { renderHook, waitFor } from "@testing-library/react"
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

  it("stashes a dirty draft on unmount so a remount can restore it", () => {
    // The inbox moves the composer between the split pane and the bottom
    // sheet when the viewport crosses its breakpoint; the remount must find
    // the unsaved reply waiting.
    const { unmount } = renderHook(() =>
      useDirtyGuard({ key: "inbox:reply:rev-2", isDirty: true, snapshot: () => "draft" })
    )
    unmount()
    expect(takeStashedDraft("inbox:reply:rev-2")).toBe("draft")
  })

  it("does not stash on unmount when clean or after a confirmed discard", async () => {
    const clean = renderHook(() =>
      useDirtyGuard({ key: "inbox:reply:rev-3", isDirty: false, snapshot: () => "" })
    )
    clean.unmount()
    expect(takeStashedDraft("inbox:reply:rev-3")).toBeNull()

    const askConfirm = vi.fn().mockResolvedValue(true)
    const dirty = renderHook(() =>
      useDirtyGuard({
        key: "inbox:reply:rev-4",
        isDirty: true,
        snapshot: () => "draft",
        askConfirm,
      })
    )
    await expect(dirty.result.current.confirmDiscard()).resolves.toBe(true)
    dirty.unmount()
    expect(takeStashedDraft("inbox:reply:rev-4")).toBeNull()
  })

  it("confirmDiscard is true when clean and asks when dirty", async () => {
    const askConfirm = vi.fn().mockResolvedValue(false)
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)

    const clean = renderHook(() =>
      useDirtyGuard({
        key: "k",
        isDirty: false,
        snapshot: () => "x",
        askConfirm,
      })
    )
    await expect(clean.result.current.confirmDiscard()).resolves.toBe(true)
    expect(askConfirm).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()

    const dirty = renderHook(() =>
      useDirtyGuard({
        key: "k2",
        isDirty: true,
        snapshot: () => "x",
        askConfirm,
      })
    )
    await expect(dirty.result.current.confirmDiscard()).resolves.toBe(false)
    expect(askConfirm).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it("falls back to window.confirm when no askConfirm is provided", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const dirty = renderHook(() =>
      useDirtyGuard({ key: "k2b", isDirty: true, snapshot: () => "x" })
    )
    await expect(dirty.result.current.confirmDiscard()).resolves.toBe(true)
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

  it("picks up a newly provided askConfirm without remounting", async () => {
    const first = vi.fn().mockResolvedValue(false)
    const second = vi.fn().mockResolvedValue(true)
    const { result, rerender } = renderHook(
      ({ askConfirm }: { askConfirm: () => Promise<boolean> }) =>
        useDirtyGuard({
          key: "k4",
          isDirty: true,
          snapshot: () => "x",
          askConfirm,
        }),
      { initialProps: { askConfirm: first } }
    )
    await expect(result.current.confirmDiscard()).resolves.toBe(false)
    rerender({ askConfirm: second })
    await waitFor(async () => {
      await expect(result.current.confirmDiscard()).resolves.toBe(true)
    })
    expect(second).toHaveBeenCalled()
  })
})
