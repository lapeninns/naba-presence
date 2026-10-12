import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

import {
  __resetLeaveGuardForTests,
  guardNavigation,
  useGuardedRouter,
  useLeaveGuard,
} from "@/lib/editors/use-leave-guard"

function Guarded({
  when,
  onLeave,
  label = "Leave",
}: {
  when: boolean
  onLeave?: () => void
  label?: string
}) {
  const prompt = useLeaveGuard({ when, onLeave })
  return prompt.open ? (
    <>
      <button type="button" onClick={prompt.onConfirm}>
        {label}
      </button>
      <button type="button" onClick={() => prompt.onOpenChange(false)}>
        Stay
      </button>
    </>
  ) : null
}

function PaletteEntry() {
  const router = useGuardedRouter()
  return (
    <button type="button" onClick={() => router.push("/inbox")}>
      Go to Inbox
    </button>
  )
}

// Real jsdom history: back() traverses asynchronously and fires popstate,
// so each step waits for the traversal (and any skip it triggers) to settle.
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}
async function pressBack() {
  window.history.back()
  await settle()
}
let visit = 0
/** A fresh "previous page" and then the editor's page, as Next pushes them. */
function openPage(): { before: string; page: string } {
  visit += 1
  const before = `/before-${visit}`
  const page = `/page-${visit}`
  window.history.pushState({ __NA: true }, "", before)
  window.history.pushState({ __NA: true }, "", page)
  return { before, page }
}
/** A client-side navigation to another page (Next's router.push). */
function navigate(path: string) {
  window.history.pushState({ __NA: true }, "", path)
}
function marker(key: string): unknown {
  return (window.history.state as Record<string, unknown> | null)?.[key]
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  __resetLeaveGuardForTests()
})

describe("useLeaveGuard: the back button", () => {
  it("asks even when Next rewrites the entry while handling the same popstate", async () => {
    // Next's popstate listener is registered first and React renders the
    // traversal synchronously, rewriting the landed entry's state.
    const nextRouter = () =>
      window.history.replaceState({ __NA: true }, "", window.location.pathname)
    window.addEventListener("popstate", nextRouter)
    try {
      const { page } = openPage()
      render(<Guarded when />)
      await pressBack()
      expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument()
      expect(window.location.pathname).toBe(page)
    } finally {
      window.removeEventListener("popstate", nextRouter)
    }
  })

  it("keeps a sentinel entry above a dirty page", async () => {
    const { page } = openPage()
    const length = window.history.length
    render(<Guarded when />)
    expect(window.history.length).toBe(length + 1)
    expect(window.location.pathname).toBe(page)
    const id = marker("__npLeaveGuard")
    expect(typeof id).toBe("string")
    // The entry beneath is marked as this sentinel's base.
    window.history.back()
    await settle()
    expect(marker("__npLeaveBase")).toBe(id)
  })

  it("asks before going back, and staying puts the sentinel back", async () => {
    const { page } = openPage()
    const onLeave = vi.fn()
    render(<Guarded when onLeave={onLeave} />)

    await pressBack()
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument()
    expect(window.location.pathname).toBe(page)

    fireEvent.click(screen.getByRole("button", { name: "Stay" }))
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
    expect(typeof marker("__npLeaveGuard")).toBe("string")
    expect(onLeave).not.toHaveBeenCalled()

    // The re-armed sentinel asks again.
    await pressBack()
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument()
  })

  it("goes back for real once the operator agrees to leave", async () => {
    const { before } = openPage()
    const onLeave = vi.fn()
    render(<Guarded when onLeave={onLeave} />)
    await pressBack()
    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    await settle()
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe(before)
  })

  it("ignores a forward step onto the sentinel and a jump within the page", async () => {
    const { page } = openPage()
    render(<Guarded when />)
    await pressBack()
    fireEvent.click(screen.getByRole("button", { name: "Stay" }))

    // A fragment link adds an entry at another address: going back from it
    // lands on the sentinel, which is still this page.
    window.location.hash = "section"
    await settle()
    await pressBack()
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
    expect(window.location.pathname + window.location.hash).toBe(page)
  })

  it("skips a sentinel left behind once the edits are saved", async () => {
    const { before } = openPage()
    const { rerender } = render(<Guarded when />)
    rerender(<Guarded when={false} />)
    await pressBack()
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
    // The operator meant to go back past the duplicate entry.
    expect(window.location.pathname).toBe(before)
  })

  it("does not skip a later visit to the same address", async () => {
    const { page } = openPage()
    const { rerender } = render(<Guarded when />)
    // Saved: the sentinel stays behind. Then Hours, Profile again (a new,
    // clean entry at the same address) and Hours again.
    rerender(<Guarded when={false} />)
    navigate(`${page}/hours`)
    navigate(page)
    navigate(`${page}/hours`)

    await pressBack()
    expect(window.location.pathname).toBe(page)
    expect(marker("__npLeaveGuard")).toBeUndefined()
    expect(marker("__npLeaveBase")).toBeUndefined()
    await pressBack()
    expect(window.location.pathname).toBe(`${page}/hours`)
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
  })

  it("does not skip the entry beneath a sentinel a navigation replaced", async () => {
    const { page } = openPage()
    const { rerender } = render(<Guarded when />)
    rerender(<Guarded when={false} />)
    // router.replace to another page rewrites the sentinel entry.
    window.history.replaceState({ __NA: true }, "", "/elsewhere")
    expect(marker("__npLeaveGuard")).toBeUndefined()

    await pressBack()
    expect(window.location.pathname).toBe(page)
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
  })

  it("keeps the sentinel through a router.refresh and leaves in one step", async () => {
    const { before, page } = openPage()
    const { rerender } = render(<Guarded when />)
    const length = window.history.length
    // Next rewrites the current entry with only its own state.
    window.history.replaceState({ __NA: true, tree: [] }, "", page)
    expect(typeof marker("__npLeaveGuard")).toBe("string")
    expect(marker("tree")).toEqual([])

    // Saved, then edited again: the page still stands on its sentinel.
    rerender(<Guarded when={false} />)
    rerender(<Guarded when />)
    expect(window.history.length).toBe(length)

    await pressBack()
    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    await settle()
    expect(window.location.pathname).toBe(before)
  })

  it("asks once for several dirty editors and forgets all their edits", async () => {
    const { before } = openPage()
    const first = vi.fn()
    const second = vi.fn()
    render(
      <>
        <Guarded when onLeave={first} label="Leave first" />
        <Guarded when onLeave={second} label="Leave second" />
      </>
    )
    await pressBack()
    // The newest guard asks.
    expect(screen.queryByRole("button", { name: "Leave first" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Leave second" }))
    await settle()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe(before)
  })
})

describe("useGuardedRouter", () => {
  let back: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    back = vi.spyOn(window.history, "back").mockImplementation(() => {})
    push.mockReset()
    replace.mockReset()
  })

  it("navigates at once when nothing is dirty", () => {
    render(<PaletteEntry />)
    fireEvent.click(screen.getByRole("button", { name: "Go to Inbox" }))
    expect(push).toHaveBeenCalledWith("/inbox")
  })

  it("holds router.push behind the leave prompt while an editor is dirty", () => {
    const onLeave = vi.fn()
    render(
      <>
        <Guarded when onLeave={onLeave} />
        <PaletteEntry />
      </>
    )
    fireEvent.click(screen.getByRole("button", { name: "Go to Inbox" }))
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Stay" }))
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Go to Inbox" }))
    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith("/inbox")
    // Leaving through the router never touches the history stack itself.
    expect(back).not.toHaveBeenCalled()
  })

  it("guardNavigation runs the navigation it was given once confirmed", () => {
    render(<Guarded when />)
    const run = vi.fn()
    act(() => guardNavigation(run))
    expect(run).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    expect(run).toHaveBeenCalledTimes(1)
  })
})
