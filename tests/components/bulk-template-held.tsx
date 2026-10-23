import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import * as React from "react"
import { afterEach, vi } from "vitest"

import { gate } from "./bulk-template-gate"
import type { ReviewRow } from "@/lib/contracts/reviews"

/**
 * Support for the tests of the template batch while its code is on the way.
 * The test file mocks `@/components/inbox/template-dialog-loader` with the
 * held import (see bulk-template-gate.ts). The bar keeps what it has loaded at
 * module level, as the app does, so a scenario that releases the code would
 * leave the next with it already here. `renderBar` therefore starts every
 * scenario from a clean slate: a new unreleased gate, and the bar's modules
 * imported afresh (vi.resetModules), together with the selection, toast and
 * query-hook modules they share, so that the spies and the contexts are the
 * very instances the bar uses. Packages in node_modules (React, TanStack)
 * stay the one copy.
 */

function review(id: string, clientId: string): ReviewRow {
  return {
    id,
    location: {
      id: `l-${clientId}`,
      name: "Girton",
      clientId,
      clientName: clientId,
    },
    reviewer: { displayName: "Sam", isAnonymous: false, profilePhotoUrl: null },
    rating: 5,
    text: null,
    detectedLanguageCode: null,
    languageConfidence: null,
    createTime: "2026-09-01T10:00:00.000Z",
    updateTime: "2026-09-01T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "new",
    draftId: null,
    draftBody: null,
    verificationStatus: null,
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: "succeeded",
    capabilities: {
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
    },
  } as unknown as ReviewRow
}

type Modules = Awaited<ReturnType<typeof freshModules>>

async function freshModules() {
  vi.resetModules()
  gate.reset()
  const [bar, selectionContext, toast, bulkHook, membersHook, sessionHook] =
    await Promise.all([
      import("@/components/inbox/bulk-action-bar"),
      import("@/components/inbox/selection-context"),
      import("@/components/ui/toast"),
      import("@/lib/queries/use-bulk-review-action"),
      import("@/lib/queries/use-members"),
      import("@/lib/queries/use-session"),
    ])
  return { bar, selectionContext, toast, bulkHook, membersHook, sessionHook }
}

function makeHarness({ bar, selectionContext }: Modules) {
  const { BulkActionBar } = bar
  const { useSelection } = selectionContext
  return function Harness() {
    const selection = useSelection()
    const [rows, setRows] = React.useState([review("a", "crown")])
    const [scopeKey, setScopeKey] = React.useState("crown")
    const applied = React.useRef(false)
    React.useEffect(() => {
      if (applied.current) return
      applied.current = true
      selection.replace(["a"])
    }, [selection])
    return (
      <>
        {/* What the list header keeps while nothing is selected. */}
        <div data-slot="inbox-list-header">
          <button type="button">Select</button>
        </div>
        <button type="button" onClick={() => selection.clear()}>
          clear the selection
        </button>
        {/* The client changes while the list still holds the previous rows (it
          keeps them until the new ones arrive). */}
        <button type="button" onClick={() => setScopeKey("old-school")}>
          change the client, keep the rows
        </button>
        {/* The new client's rows arrive at last. */}
        <button
          type="button"
          onClick={() => setRows([review("z", "old-school")])}
        >
          new rows arrive
        </button>
        {/* A refetch: the same reviews, a new array. */}
        <button type="button" onClick={() => setRows((now) => [...now])}>
          refetch
        </button>
        {/* Another client's reviews arrive while the old ids stay selected (a
          scope change does not clear the selection). */}
        <button
          type="button"
          onClick={() => setRows([review("z", "old-school")])}
        >
          switch client
        </button>
        <BulkActionBar rows={rows} scopeKey={scopeKey} />
      </>
    )
  }
}

async function renderBar() {
  const modules = await freshModules()
  const { bulkHook, membersHook, sessionHook } = modules
  const { SelectionProvider } = modules.selectionContext
  const { Toaster } = modules.toast
  const Harness = makeHarness(modules)
  vi.spyOn(bulkHook, "useBulkReviewAction").mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof bulkHook.useBulkReviewAction>)
  vi.spyOn(sessionHook, "useSession").mockReturnValue({
    data: { session: { userId: "me-1", role: "owner" } },
    isError: false,
  } as unknown as ReturnType<typeof sessionHook.useSession>)
  vi.spyOn(membersHook, "useMembers").mockReturnValue({
    data: { members: [] },
  } as unknown as ReturnType<typeof membersHook.useMembers>)
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Toaster>
        <SelectionProvider>
          <Harness />
        </SelectionProvider>
      </Toaster>
    </QueryClientProvider>
  )
}

const TITLE = "Reply with the rating template"
// The toast viewport is also a dialog; the batch is the one with this name.
const batch = () => screen.queryByRole("dialog", { name: TITLE })

/** Lets the held code go and the app settle after it. */
async function release() {
  await act(async () => {
    gate.release()
    // The real dialog's module graph loads afresh in every case: wait for it.
    await Promise.allSettled(gate.imports)
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

/**
 * The batch's dialog once it has stopped changing. The dialog primitive draws
 * itself once and then again a few milliseconds later (it settles its phone or
 * desk drawing after mount), so a node found at once can be gone by the next
 * line; a test that holds on to one waits for the second drawing.
 */
async function settledDialog() {
  let node = await screen.findByRole("dialog", { name: TITLE })
  for (let steady = 0; steady < 3;) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const next = screen.queryByRole("dialog", { name: TITLE })
    steady = next === node ? steady + 1 : 0
    if (next) node = next
  }
  return node
}

/** A click from outside the modal, as a refetch or a scope switch is. */
async function clickBehindTheModal(name: string) {
  await act(async () => {
    screen.getByRole("button", { name, hidden: true }).click()
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

export { batch, clickBehindTheModal, release, renderBar, settledDialog, TITLE }
