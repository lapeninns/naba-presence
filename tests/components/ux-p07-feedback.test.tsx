import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { announceSwitch } from "@/components/app-shell/scope-sheet-model"
import {
  Toaster,
  applyWithUndo,
  createToastManager,
  showToast,
  toast,
  type ToastManagerLike,
} from "@/components/ui/toast"
import { useOptimisticMutation } from "@/lib/queries/use-optimistic-mutation"

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const toastEls = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast"]'))

/** Closed: removed, or on its way out (the exit transition). */
const open = () =>
  toastEls().filter((el) => !el.hasAttribute("data-ending-style"))

afterEach(() => {
  // The module-level `toast` is a singleton: clear it between tests.
  act(() => toast.close())
})

function setupManager() {
  const manager = createToastManager() as unknown as ToastManagerLike
  render(<Toaster toastManager={manager as never} />)
  return manager
}

describe("toast replace by id", () => {
  it("adding the same id twice leaves one toast with the new content", () => {
    const manager = setupManager()
    act(() => {
      manager.add({ id: "same", title: "First", description: "Old detail" })
    })
    act(() => {
      manager.add({ id: "same", title: "Second" })
    })
    // Through the raw manager nothing resets the description: that is the
    // wrapped `toast` and `useToastManager`'s job (below).
    expect(toastEls()).toHaveLength(1)
    expect(screen.getByText("Second")).toBeInTheDocument()
    expect(screen.queryByText("First")).toBeNull()
  })

  it("replaces in place through the app's `toast`, dropping the old toast's Undo and description", async () => {
    render(<Toaster />)
    act(() => {
      showToast({
        id: "scope",
        title: "Marked done",
        description: "Old detail",
        undo: { onUndo: vi.fn() },
      })
    })
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument()
    const first = toastEls()[0]

    act(() => {
      toast.add({ id: "scope", title: "Switched to Harbour Kitchen" })
    })

    expect(toastEls()).toHaveLength(1)
    // The same element: updated, not removed and added again.
    expect(toastEls()[0]).toBe(first)
    expect(screen.getByText("Switched to Harbour Kitchen")).toBeInTheDocument()
    expect(screen.queryByText("Marked done")).toBeNull()
    expect(screen.queryByText("Old detail")).toBeNull()
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })

  it("restarts the auto-dismiss when replaced", () => {
    vi.useFakeTimers()
    try {
      render(<Toaster />)
      act(() => {
        toast.add({ id: "t", title: "One", timeout: 1000 })
      })
      act(() => {
        vi.advanceTimersByTime(800)
      })
      act(() => {
        toast.add({ id: "t", title: "Two", timeout: 1000 })
      })
      // 800ms into the first timer, 800ms into the second: the first would
      // have fired by now.
      act(() => {
        vi.advanceTimersByTime(800)
      })
      expect(open()).toHaveLength(1)
      expect(screen.getByText("Two")).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(open()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a different id still stacks", () => {
    render(<Toaster />)
    act(() => {
      toast.add({ id: "a", title: "A" })
      toast.add({ id: "b", title: "B" })
    })
    expect(toastEls()).toHaveLength(2)
  })
})

describe("scope switch toast", () => {
  it("switching scope three times in a row shows one toast, with the latest name", () => {
    render(<Toaster />)
    act(() => announceSwitch("Old Crown"))
    act(() => announceSwitch("Harbour Kitchen"))
    act(() => announceSwitch("All clients"))
    expect(toastEls()).toHaveLength(1)
    expect(screen.getByText("Switched to All clients")).toBeInTheDocument()
    expect(screen.queryByText("Switched to Old Crown")).toBeNull()
    expect(screen.queryByText("Switched to Harbour Kitchen")).toBeNull()
  })
})

describe("applyWithUndo", () => {
  it("applies at once and Undo reverts with what apply returned", async () => {
    const manager = setupManager()
    let value = "unanswered"
    act(() => {
      applyWithUndo({
        title: "Marked as no reply needed",
        apply: () => {
          const previous = value
          value = "no_reply_needed"
          return previous
        },
        revert: (previous) => {
          value = previous
        },
        manager,
      })
    })
    // Not waiting on the toast or its Undo.
    expect(value).toBe("no_reply_needed")
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Undo" }))
    })
    expect(value).toBe("unanswered")
    await waitFor(() => expect(open()).toHaveLength(0))
  })
})

describe("useOptimisticMutation", () => {
  type Item = { id: string; read: boolean }
  const KEY = ["p07", "items"] as const

  function setup(mutationFn: (id: string) => Promise<void>) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    client.setQueryData<Item[]>(KEY, [
      { id: "a", read: false },
      { id: "b", read: false },
    ])
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <Toaster />
        {children}
      </QueryClientProvider>
    )
    const hook = renderHook(
      () =>
        useOptimisticMutation<void, string, Item[]>({
          mutationFn,
          queryKey: KEY,
          update: (current, id) =>
            current?.map((item) =>
              item.id === id ? { ...item, read: true } : item
            ),
          errorTitle: "Could not mark as read",
          errorDescription: (error) => error.message,
        }),
      { wrapper }
    )
    return { client, invalidate, ...hook }
  }

  it("shows the change before the server answers, then refetches", async () => {
    let finish: () => void = () => {}
    const { client, invalidate, result } = setup(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    act(() => result.current.mutate("a"))
    await waitFor(() =>
      expect(client.getQueryData<Item[]>(KEY)).toEqual([
        { id: "a", read: true },
        { id: "b", read: false },
      ])
    )
    expect(result.current.isPending).toBe(true)
    expect(toastEls()).toHaveLength(0)

    await act(async () => finish())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY })
    expect(toastEls()).toHaveLength(0)
  })

  it("cancels in-flight fetches of the query before changing it", async () => {
    const { client, result } = setup(() => Promise.resolve())
    const cancel = vi.spyOn(client, "cancelQueries")
    await act(async () => result.current.mutateAsync("a"))
    expect(cancel).toHaveBeenCalledWith({ queryKey: KEY })
  })

  it("rolls back and shows an error toast when the server refuses", async () => {
    const { client, invalidate, result } = setup(() =>
      Promise.reject(new Error("Server said no"))
    )
    await act(async () => {
      await result.current.mutateAsync("a").catch(() => {})
    })
    expect(client.getQueryData<Item[]>(KEY)).toEqual([
      { id: "a", read: false },
      { id: "b", read: false },
    ])
    expect(await screen.findByText("Could not mark as read")).toBeVisible()
    expect(screen.getByText("Server said no")).toBeVisible()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY })
  })

  it("a second failure replaces the error toast rather than stacking", async () => {
    const { result } = setup(() => Promise.reject(new Error("Nope")))
    for (const id of ["a", "b"]) {
      await act(async () => {
        await result.current.mutateAsync(id).catch(() => {})
      })
    }
    expect(toastEls()).toHaveLength(1)
  })
})
