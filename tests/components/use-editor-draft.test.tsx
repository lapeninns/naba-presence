import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { __resetDraftSources, takeStashedDraft } from "@/lib/api/draft-stash"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { guardedHref, useLeaveGuard } from "@/lib/editors/use-leave-guard"

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

type Props = { initial: { name: string }; revision: string | null }

function useDraft(props: Props) {
  return useEditorDraft({ ...props, key: "test-draft" })
}

describe("useEditorDraft", () => {
  it("follows a new revision when the draft is clean", () => {
    const { result, rerender } = renderHook(useDraft, {
      initialProps: { initial: { name: "A" }, revision: "1" },
    })
    rerender({ initial: { name: "B" }, revision: "2" })
    expect(result.current.draft).toEqual({ name: "B" })
    expect(result.current.incoming).toBe(false)
  })

  it("keeps unsaved edits when someone else saves, and lets the operator choose", () => {
    const { result, rerender } = renderHook(useDraft, {
      initialProps: { initial: { name: "A" }, revision: "1" },
    })
    act(() => result.current.setDraft({ name: "Mine" }))
    rerender({ initial: { name: "Theirs" }, revision: "2" })
    expect(result.current.draft).toEqual({ name: "Mine" })
    expect(result.current.incoming).toBe(true)

    act(() => result.current.keepMine())
    expect(result.current.incoming).toBe(false)
    expect(result.current.draft).toEqual({ name: "Mine" })
    expect(result.current.isDirty).toBe(true)

    rerender({ initial: { name: "Third" }, revision: "3" })
    expect(result.current.incoming).toBe(true)
    act(() => result.current.loadIncoming())
    expect(result.current.draft).toEqual({ name: "Third" })
    expect(result.current.isDirty).toBe(false)
  })

  it("follows its own save silently", () => {
    const { result, rerender } = renderHook(useDraft, {
      initialProps: { initial: { name: "A" }, revision: "1" },
    })
    act(() => result.current.setDraft({ name: "Edited" }))
    act(() => result.current.expectSave())
    // The server normalised what was saved, so it isn't byte-identical.
    rerender({ initial: { name: "Edited " }, revision: "2" })
    expect(result.current.incoming).toBe(false)
    expect(result.current.draft).toEqual({ name: "Edited " })
  })

  it("treats a first revision after a missing one as the seed", () => {
    const { result, rerender } = renderHook(useDraft, {
      initialProps: { initial: { name: "" }, revision: null } as Props,
    })
    act(() => result.current.setDraft({ name: "typed early" }))
    rerender({ initial: { name: "From Google" }, revision: "h1" })
    expect(result.current.incoming).toBe(false)
    expect(result.current.draft).toEqual({ name: "From Google" })
  })

  it("stashes dirty edits on unmount and offers them back on the next mount", () => {
    const first = renderHook(useDraft, {
      initialProps: { initial: { name: "A" }, revision: "1" },
    })
    act(() => first.result.current.setDraft({ name: "Left behind" }))
    first.unmount()

    const second = renderHook(useDraft, {
      initialProps: { initial: { name: "A" }, revision: "1" },
    })
    expect(second.result.current.stashed).toBe(true)
    expect(second.result.current.draft).toEqual({ name: "A" })
    act(() => second.result.current.restoreStashed())
    expect(second.result.current.draft).toEqual({ name: "Left behind" })
    expect(second.result.current.stashed).toBe(false)
    expect(takeStashedDraft("test-draft")).toBeNull()
  })

  it("does not stash edits the operator agreed to lose", () => {
    const first = renderHook(useDraft, {
      initialProps: { initial: { name: "A" }, revision: "1" },
    })
    act(() => first.result.current.setDraft({ name: "Gone" }))
    act(() => first.result.current.forget())
    first.unmount()
    expect(takeStashedDraft("test-draft")).toBeNull()
  })
})

function Guarded({ when, onLeave }: { when: boolean; onLeave: () => void }) {
  const prompt = useLeaveGuard({ when, onLeave })
  return (
    <>
      {/* A plain anchor on purpose: the guard must catch any in-app link. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/listings/other">Other listing</a>
      <a href="#section">Jump</a>
      <a href="https://example.com/">Outside</a>
      {prompt.open ? (
        <button type="button" onClick={prompt.onConfirm}>
          Leave
        </button>
      ) : null}
    </>
  )
}

describe("useLeaveGuard", () => {
  it("holds an in-app link while dirty and follows it once confirmed", () => {
    const onLeave = vi.fn()
    const followed = vi.fn((event: MouseEvent) => event.preventDefault())
    render(<Guarded when onLeave={onLeave} />)
    const link = screen.getByRole("link", { name: "Other listing" })
    link.addEventListener("click", followed)

    fireEvent.click(link)
    expect(followed).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(followed).toHaveBeenCalledTimes(1)
  })

  it("lets links through while clean", () => {
    const followed = vi.fn((event: MouseEvent) => event.preventDefault())
    render(<Guarded when={false} onLeave={vi.fn()} />)
    const link = screen.getByRole("link", { name: "Other listing" })
    link.addEventListener("click", followed)
    fireEvent.click(link)
    expect(followed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
  })

  it("ignores in-page jumps, other origins and modified clicks", () => {
    render(<Guarded when onLeave={vi.fn()} />)
    const make = (name: string, init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", {
        bubbles: true,
        button: 0,
        ...init,
      })
      Object.defineProperty(event, "target", {
        value: screen.getByRole("link", { name }),
      })
      return guardedHref(event)
    }
    expect(make("Jump")).toBeNull()
    expect(make("Outside")).toBeNull()
    expect(make("Other listing", { metaKey: true })).toBeNull()
    expect(make("Other listing")?.href).toBe("/listings/other")
  })
})
