import { act, fireEvent, render, screen } from "@testing-library/react"
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

/** The browser's back button, from the sentinel to the entry beneath it. */
function pressBack() {
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }))
  })
}

let back: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  back = vi.spyOn(window.history, "back").mockImplementation(() => {})
  push.mockReset()
  replace.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("useLeaveGuard: the back button", () => {
  it("keeps a sentinel entry above a dirty page", () => {
    const pushState = vi.spyOn(window.history, "pushState")
    render(<Guarded when />)
    // Either a fresh sentinel was pushed, or the page already sits on one.
    expect(
      pushState.mock.calls.length > 0 ||
        (window.history.state as Record<string, unknown>)?.__npLeaveGuard
    ).toBeTruthy()
    expect(
      (window.history.state as Record<string, unknown>).__npLeaveGuard
    ).toBe(true)
  })

  it("asks before going back, and staying puts the sentinel back", () => {
    const onLeave = vi.fn()
    render(<Guarded when onLeave={onLeave} />)
    const pushState = vi.spyOn(window.history, "pushState")

    pressBack()
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument()
    expect(back).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Stay" }))
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState.mock.calls[0]?.[0]).toEqual({ __npLeaveGuard: true })
    expect(onLeave).not.toHaveBeenCalled()

    // The re-armed sentinel asks again.
    pressBack()
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument()
  })

  it("goes back for real once the operator agrees to leave", () => {
    const onLeave = vi.fn()
    render(<Guarded when onLeave={onLeave} />)
    pressBack()
    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(back).toHaveBeenCalledTimes(1)
  })

  it("ignores a forward step onto the sentinel and a jump within the page", () => {
    render(<Guarded when />)
    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { __npLeaveGuard: true } })
      )
    })
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()

    // A fragment link changes the address: not the entry beneath the sentinel.
    const before = window.location.href
    window.history.replaceState(window.history.state, "", "#section")
    pressBack()
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
    window.history.replaceState(window.history.state, "", before)
  })

  it("skips a sentinel left behind once the edits are saved", () => {
    const { rerender } = render(<Guarded when />)
    rerender(<Guarded when={false} />)
    pressBack()
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()
    // The operator meant to go back past the duplicate entry.
    expect(back).toHaveBeenCalledTimes(1)
  })

  it("asks once for several dirty editors and forgets all their edits", () => {
    const first = vi.fn()
    const second = vi.fn()
    render(
      <>
        <Guarded when onLeave={first} label="Leave first" />
        <Guarded when onLeave={second} label="Leave second" />
      </>
    )
    pressBack()
    // The newest guard asks.
    expect(screen.queryByRole("button", { name: "Leave first" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Leave second" }))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(back).toHaveBeenCalledTimes(1)
  })
})

describe("useGuardedRouter", () => {
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
