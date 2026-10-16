import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BulkActionBar } from "@/components/inbox/bulk-action-bar"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
import { Toaster } from "@/components/ui/toast"
import type { ReviewRow } from "@/lib/contracts/reviews"
import * as bulkHook from "@/lib/queries/use-bulk-review-action"
import * as membersHook from "@/lib/queries/use-members"
import * as sessionHook from "@/lib/queries/use-session"

// The template dialog's code is held until a test lets it go: the moment
// between the click and the chunk arriving, on a slow connection.
const gate = vi.hoisted(() => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
})
vi.mock("@/components/inbox/template-reply-dialog", async (importOriginal) => {
  await gate.promise
  return await importOriginal<
    typeof import("@/components/inbox/template-reply-dialog")
  >()
})

const ratingOnly = {
  id: "a",
  location: { id: "l1", name: "Girton", clientId: "c1", clientName: "Crown" },
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
  capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
} as unknown as ReviewRow

function Harness() {
  const selection = useSelection()
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
      <BulkActionBar rows={[ratingOnly]} />
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

/** Lets the held import go and the app settle after it. */
async function release() {
  await act(async () => {
    gate.release()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

afterEach(() => vi.restoreAllMocks())

describe("an open that is still waiting for the template code", () => {
  it("is cancelled with the selection it was made on", async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(
      await screen.findByRole("dialog", { name: TITLE })
    ).toBeInTheDocument()

    // The modal holds the page, so the selection is cleared the way a scope
    // change does it: from outside (the harness's button is behind the
    // modal for a person, but a scope switch is not).
    await act(async () => {
      screen
        .getByRole("button", { name: "clear the selection", hidden: true })
        .click()
    })
    expect(batch()).not.toBeInTheDocument()

    // The code arrives later: nothing opens, over this or any other scope.
    await release()
    expect(batch()).not.toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "Selected reviews" })
    ).not.toBeInTheDocument()
  })
})
