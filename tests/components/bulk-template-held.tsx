import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import * as React from "react"
import { afterEach, vi } from "vitest"

import { BulkActionBar } from "@/components/inbox/bulk-action-bar"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
import { Toaster } from "@/components/ui/toast"
import { gate } from "./bulk-template-gate"
import type { ReviewRow } from "@/lib/contracts/reviews"
import * as bulkHook from "@/lib/queries/use-bulk-review-action"
import * as membersHook from "@/lib/queries/use-members"
import * as sessionHook from "@/lib/queries/use-session"

/**
 * Support for the tests of the template batch while its code is on the way.
 * Each test file mocks `@/components/inbox/template-reply-dialog` as a held
 * module (see bulk-template-gate.ts) and holds one scenario: the bar keeps what
 * it has loaded at module level, as the app does, so a scenario that releases
 * the code would leave the next in the same file with it already here.
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

function Harness() {
  const selection = useSelection()
  const [rows, setRows] = React.useState([review("a", "crown")])
  const applied = React.useRef(false)
  React.useEffect(() => {
    if (applied.current) return
    applied.current = true
    selection.replace(["a"])
  }, [selection])
  return (
    <>
      <button type="button" onClick={() => selection.clear()}>
        clear the selection
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
      <BulkActionBar rows={rows} />
    </>
  )
}

function renderBar() {
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
