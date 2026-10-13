import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DirtyGuardProvider,
  useAskDiscardConfirm,
  useDirtyGate,
  useRegisterDirtyGuard,
} from "@/components/inbox/dirty-context"
import { __resetLeaveGuardForTests } from "@/lib/editors/use-leave-guard"

// The inbox's unsaved reply is guarded against leaving the page too: the OS
// back gesture, a shell link or a guarded navigation asks through the same
// "Discard unsaved reply?" dialog as the in-page gate.

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

function Composer({
  dirty,
  discard,
}: {
  dirty: boolean
  discard: () => void
}) {
  // The composer's confirm is the provider's dialog (through useDirtyGuard).
  const ask = useAskDiscardConfirm() ?? (async () => true)
  useRegisterDirtyGuard(dirty, ask, undefined, discard)
  const gate = useDirtyGate()
  return (
    <>
      <a href="/settings">Settings</a>
      <button type="button" onClick={() => void gate()}>
        Next review
      </button>
    </>
  )
}

function mount(dirty: boolean, discard = vi.fn()) {
  const view = render(
    <DirtyGuardProvider>
      <Composer dirty={dirty} discard={discard} />
    </DirtyGuardProvider>
  )
  return { ...view, discard }
}

function marker(key: string): unknown {
  return (window.history.state as Record<string, unknown> | null)?.[key]
}

afterEach(() => {
  __resetLeaveGuardForTests()
  vi.restoreAllMocks()
})

describe("DirtyGuardProvider — leaving the inbox", () => {
  it("arms the back-gesture sentinel only while the reply is dirty", () => {
    window.history.pushState({}, "", "/inbox-clean")
    mount(false)
    expect(marker("__npLeaveGuard")).toBeUndefined()
  })

  it("asks before the OS back gesture leaves a dirty reply, and forgets it on Discard", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/inbox?selected=rev-1")
    const { discard } = mount(true)
    expect(marker("__npLeaveGuard")).toEqual(expect.any(String))

    window.history.back()
    await settle()
    const dialog = await screen.findByRole("alertdialog", {
      name: "Discard unsaved reply?",
    })
    expect(dialog).toBeInTheDocument()
    expect(discard).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it("keeps the reply on Keep editing and asks again on the next back", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/inbox?selected=rev-2")
    const { discard } = mount(true)
    window.history.back()
    await settle()
    await user.click(
      await screen.findByRole("button", { name: "Keep editing" })
    )
    expect(discard).not.toHaveBeenCalled()
    // The sentinel is back, so the next back press asks again.
    expect(marker("__npLeaveGuard")).toEqual(expect.any(String))
  })

  it("holds an in-app link behind the same dialog", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/inbox?selected=rev-3")
    mount(true)
    await user.click(screen.getByRole("link", { name: "Settings" }))
    expect(
      await screen.findByRole("alertdialog", { name: "Discard unsaved reply?" })
    ).toBeInTheDocument()
    // One dialog, not two stacked.
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1)
  })

  it("still gates in-page navigation through the same dialog", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/inbox?selected=rev-4")
    mount(true)
    await user.click(screen.getByRole("button", { name: "Next review" }))
    expect(
      await screen.findByRole("alertdialog", { name: "Discard unsaved reply?" })
    ).toBeInTheDocument()
  })
})
