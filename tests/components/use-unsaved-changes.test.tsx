import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  __resetDraftSources,
  abandonAllDrafts,
  peekStashedDraft,
  stashAllDrafts,
} from "@/lib/api/draft-stash"
import { __resetLeaveGuardForTests } from "@/lib/editors/use-leave-guard"
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes"

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => __resetLeaveGuardForTests())

/** Dispatches a reload's `beforeunload`; true when something asked to stay. */
function reloadWarns() {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

type Draft = { text: string }
const parse = (value: unknown): Draft | null =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Draft).text === "string" &&
  (value as Draft).text !== "saved"
    ? (value as Draft)
    : null

describe("useUnsavedChanges", () => {
  it("warns on a reload only while dirty", () => {
    const { rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) =>
        useUnsavedChanges({ scope: "editor/1", isDirty: dirty }),
      { initialProps: { dirty: false } }
    )
    expect(reloadWarns()).toBe(false)
    rerender({ dirty: true })
    expect(reloadWarns()).toBe(true)
    rerender({ dirty: false })
    expect(reloadWarns()).toBe(false)
  })

  it("does not warn once a forced sign-out has abandoned the drafts", () => {
    renderHook(() => useUnsavedChanges({ scope: "editor/2", isDirty: true }))
    abandonAllDrafts()
    expect(reloadWarns()).toBe(false)
  })

  it("stashes nothing for an editor that cannot offer edits back", () => {
    const { unmount } = renderHook(() =>
      useUnsavedChanges({ scope: "editor/3", isDirty: true })
    )
    stashAllDrafts()
    unmount()
    expect(Object.keys(sessionStorage)).toEqual([])
  })

  it("keeps a restorable editor's edits and offers them back once", () => {
    const first = renderHook(() =>
      useUnsavedChanges<Draft>({
        scope: "editor/4",
        isDirty: true,
        restore: { snapshot: () => ({ text: "mine" }), parse },
      })
    )
    expect(first.result.current.stashed).toBeNull()
    first.unmount()
    expect(peekStashedDraft("editor/4")).toBe(JSON.stringify({ text: "mine" }))

    const second = renderHook(() =>
      useUnsavedChanges<Draft>({
        scope: "editor/4",
        isDirty: false,
        restore: { snapshot: () => ({ text: "" }), parse },
      })
    )
    expect(second.result.current.stashed).toEqual({ text: "mine" })
    let restored: Draft | null = null
    act(() => {
      restored = second.result.current.restoreStashed()
    })
    expect(restored).toEqual({ text: "mine" })
    expect(second.result.current.stashed).toBeNull()
    expect(peekStashedDraft("editor/4")).toBeNull()
  })

  it("offers nothing for a stash that matches what is saved, until ready", () => {
    sessionStorage.setItem("naba:draft:editor/5", JSON.stringify({ text: "saved" }))
    sessionStorage.setItem("naba:draft:editor/6", JSON.stringify({ text: "edit" }))
    const same = renderHook(() =>
      useUnsavedChanges<Draft>({
        scope: "editor/5",
        isDirty: false,
        restore: { snapshot: () => ({ text: "" }), parse },
      })
    )
    expect(same.result.current.stashed).toBeNull()
    const waiting = renderHook(
      ({ ready }: { ready: boolean }) =>
        useUnsavedChanges<Draft>({
          scope: "editor/6",
          isDirty: false,
          restore: { snapshot: () => ({ text: "" }), parse, ready },
        }),
      { initialProps: { ready: false } }
    )
    expect(waiting.result.current.stashed).toBeNull()
    waiting.rerender({ ready: true })
    expect(waiting.result.current.stashed).toEqual({ text: "edit" })
    act(() => waiting.result.current.dismissStashed())
    expect(waiting.result.current.stashed).toBeNull()
    expect(peekStashedDraft("editor/6")).toBeNull()
  })

  it("guards edits made after a discard once the content was clean again", () => {
    const { result, rerender, unmount } = renderHook(
      ({ dirty }: { dirty: boolean }) =>
        useUnsavedChanges<Draft>({
          scope: "editor/7",
          isDirty: dirty,
          restore: { snapshot: () => ({ text: "second" }), parse },
        }),
      { initialProps: { dirty: true } }
    )
    // Agreed to leave, but the page stayed: the edits went, then new ones.
    act(() => result.current.forget())
    expect(reloadWarns()).toBe(false)
    rerender({ dirty: false })
    rerender({ dirty: true })
    expect(reloadWarns()).toBe(true)
    unmount()
    expect(peekStashedDraft("editor/7")).toBe(JSON.stringify({ text: "second" }))
  })
})
