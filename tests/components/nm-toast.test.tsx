import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import {
  ACTION_TOAST_TIMEOUT,
  ERROR_TOAST_TIMEOUT,
  Toaster,
  createToastManager,
  showToast,
  toastProgress,
  type OutcomeToastOptions,
  type ToastKind,
  type ToastManagerLike,
} from "@/components/ui/toast"

// A fresh manager per test: the module-level `toast` is a singleton, and a
// toast left over from one test would leak into the next.
function setup() {
  const manager = createToastManager() as unknown as ToastManagerLike
  const fire = vi.fn()
  render(
    <Toaster toastManager={manager as never}>
      <Button onClick={fire}>Fire</Button>
    </Toaster>
  )
  return manager
}

const toastEl = () =>
  document.querySelector('[data-slot="toast"]') as HTMLElement | null

/** Closed: removed, or on its way out (the exit transition). */
const isClosed = (el: HTMLElement | null) =>
  el === null || !el.isConnected || el.hasAttribute("data-ending-style")

afterEach(() => {
  vi.useRealTimers()
})

describe("Toast look", () => {
  it("is a charcoal 12px-radius toast at least 52px tall, in body text", () => {
    const manager = setup()
    act(() => {
      showToast({ title: "Review marked done" }, manager)
    })
    const root = toastEl()!
    expect(root.className).toContain("rounded-toast")
    expect(root.className).toContain("bg-charcoal")
    expect(root.className).toContain("text-ink-on-charcoal")
    expect(root.className).toContain("shadow-np-float")
    const content = root.querySelector('[data-slot="toast-content"]')!
    // min-h-13 = 52px on the 4px spacing scale.
    expect(content.className).toContain("min-h-13")
    expect(content.className).toContain("text-body")
    expect(screen.getByText("Review marked done").className).toContain(
      "text-body"
    )
  })

  it("docks above the owning bar, inset by the page gutter on a phone", () => {
    setup()
    const viewport = document.querySelector(
      '[data-slot="toast-viewport"]'
    ) as HTMLElement
    expect(viewport).toHaveAttribute("role", "region")
    expect(viewport).toHaveAttribute("aria-live", "polite")
    expect(viewport).toHaveAccessibleName("Notifications")
    expect(viewport.className).toContain("left-(--np-page-pad-x)")
    expect(viewport.className).toContain("right-(--np-page-pad-x)")
    expect(viewport.className).toContain("z-toast")
    // 8px above the bar on a phone.
    expect(viewport.className).toContain("[--toast-gap:--spacing(2)]")
  })
})

describe("Undo (local reversible actions)", () => {
  it("is opt-in: a plain local result has no action", () => {
    const manager = setup()
    act(() => {
      showToast({ title: "Tag added" }, manager)
    })
    expect(screen.getByText("Tag added")).toBeInTheDocument()
    expect(
      document.querySelector('[data-slot="toast-action"]')
    ).not.toBeInTheDocument()
    expect(toastEl()).toHaveAttribute("data-kind", "local")
  })

  it("is reachable by Tab, is a 44px target, and undoes and closes on Enter", async () => {
    const user = userEvent.setup()
    const manager = setup()
    const onUndo = vi.fn()
    await user.click(screen.getByRole("button", { name: "Fire" }))
    act(() => {
      showToast({ title: "Review marked done", undo: { onUndo } }, manager)
    })
    expect(screen.getByText("Review marked done")).toBeInTheDocument()

    // From "Fire": the toast's own tabbable root, then its Undo.
    await user.tab()
    await user.tab()
    const undo = screen.getByRole("button", { name: "Undo" })
    expect(undo).toHaveFocus()
    expect(undo.className).toContain("min-h-(--np-touch)")
    expect(undo.className).toContain("min-w-(--np-touch)")

    const root = toastEl()
    await user.keyboard("{Enter}")
    expect(onUndo).toHaveBeenCalledOnce()
    expect(isClosed(root)).toBe(true)
  })

  it("gives an Undo toast the longer action timeout", () => {
    vi.useFakeTimers()
    const manager = setup()
    act(() => {
      showToast(
        { title: "Archived", undo: { onUndo: () => {}, label: "Undo" } },
        manager
      )
    })
    const root = toastEl()
    act(() => {
      vi.advanceTimersByTime(ACTION_TOAST_TIMEOUT - 100)
    })
    expect(isClosed(root)).toBe(false)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(isClosed(root)).toBe(true)
  })
})

describe("Google writes (D5)", () => {
  it("carry a View on Google link and never an Undo", () => {
    const manager = setup()
    act(() => {
      showToast(
        {
          kind: "google",
          title: "Reply published",
          link: { href: "https://business.google.com/r/1" },
        },
        manager
      )
    })
    expect(toastEl()).toHaveAttribute("data-kind", "google")
    const link = screen.getByRole("link", {
      name: "View on Google (opens in a new tab)",
    })
    expect(link).toHaveAttribute("href", "https://business.google.com/r/1")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link.className).toContain("min-h-(--np-touch)")
    expect(
      screen.queryByRole("button", { name: "Undo" })
    ).not.toBeInTheDocument()
  })

  it("drops an Undo even when a caller hands the raw manager one", () => {
    const manager = setup()
    act(() => {
      manager.add({
        title: "Reply published",
        data: { kind: "google" },
        actionProps: { children: "Undo" },
      })
    })
    expect(screen.getByText("Reply published")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Undo" })
    ).not.toBeInTheDocument()
  })

  it("cannot be given an Undo in the types", () => {
    const google = {
      kind: "google",
      title: "Reply published",
      undo: { onUndo: () => {} },
    } as const
    // @ts-expect-error a Google write never offers Undo (D5)
    const options: OutcomeToastOptions = google
    expect(options.kind).toBe("google")
    const publishing = () =>
      toastProgress("Publishing…", { kind: "google" }).success(
        "Reply published",
        // @ts-expect-error nor does its progress toast's result
        { undo: { onUndo: () => {} } }
      )
    expect(typeof publishing).toBe("function")
    const kind = "google" as ToastKind
    const widened = () =>
      toastProgress("Saving…", { kind }).success(
        "Saved",
        // @ts-expect-error a kind not known to be local cannot offer Undo
        { undo: { onUndo: () => {} } }
      )
    expect(typeof widened).toBe("function")
  })
})

describe("Phases", () => {
  it("shows progress with a spinner and no auto-dismiss, then the result in the same toast", () => {
    vi.useFakeTimers()
    const manager = setup()
    let publishing!: ReturnType<typeof toastProgress<"google">>
    act(() => {
      publishing = toastProgress("Publishing reply…", {
        kind: "google",
        manager,
      })
    })
    const root = toastEl()!
    expect(root).toHaveAttribute("data-phase", "progress")
    expect(root.querySelector(".animate-spin")).not.toBeNull()
    expect(
      root.querySelector(".animate-spin")!.getAttribute("class")
    ).toContain("motion-reduce:animate-none")
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText("Publishing reply…")).toBeInTheDocument()
    expect(isClosed(root)).toBe(false)

    act(() => {
      publishing.success("Reply published", {
        link: { href: "https://business.google.com/r/1" },
      })
    })
    expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1)
    expect(toastEl()).toBe(root)
    expect(root).toHaveAttribute("data-phase", "result")
    expect(screen.getByText("Reply published")).toBeInTheDocument()
    expect(screen.queryByText("Publishing reply…")).not.toBeInTheDocument()
    expect(root.querySelector(".text-success-solid")).not.toBeNull()
    expect(
      screen.getByRole("link", { name: "View on Google (opens in a new tab)" })
    ).toBeInTheDocument()

    // The link's toast stays for the action timeout, then goes.
    act(() => {
      vi.advanceTimersByTime(ACTION_TOAST_TIMEOUT + 100)
    })
    expect(isClosed(root)).toBe(true)
  })

  it("settles a failure as an error that stays for the error timeout", () => {
    vi.useFakeTimers()
    const manager = setup()
    act(() => {
      toastProgress("Publishing reply…", { kind: "google", manager }).error(
        "Reply not published",
        { description: "Google refused it. The draft is kept here." }
      )
    })
    const root = toastEl()!
    expect(root.querySelector(".text-danger-solid")).not.toBeNull()
    expect(
      screen.getByText("Google refused it. The draft is kept here.")
    ).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(ERROR_TOAST_TIMEOUT - 100)
    })
    expect(isClosed(root)).toBe(false)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(isClosed(root)).toBe(true)
  })

  it("auto-dismisses a plain result after 5s, paused while hovered", () => {
    vi.useFakeTimers()
    const manager = setup()
    act(() => {
      showToast({ title: "Review marked done" }, manager)
    })
    const viewport = document.querySelector(
      '[data-slot="toast-viewport"]'
    ) as HTMLElement
    const root = toastEl()
    fireEvent.mouseEnter(viewport)
    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(isClosed(root)).toBe(false)
    fireEvent.mouseLeave(viewport)
    act(() => {
      vi.advanceTimersByTime(5_100)
    })
    expect(isClosed(root)).toBe(true)
  })
})

describe("Keyboard", () => {
  it("closes the focused toast on Escape", async () => {
    const user = userEvent.setup()
    const manager = setup()
    await user.click(screen.getByRole("button", { name: "Fire" }))
    act(() => {
      showToast({ title: "Tag added" }, manager)
    })
    await user.tab()
    const root = toastEl()
    expect(root).toHaveFocus()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(isClosed(root)).toBe(true))
  })
})
