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

describe("the template batch while its code is on the way", () => {
  it("is a modal from the click, and closing it cancels the open for good", async () => {
    const user = userEvent.setup()
    renderBar()
    const primary = await screen.findByRole("button", {
      name: "Reply with template",
    })
    await user.click(primary)

    // The code has not arrived, and the batch is already a modal question.
    const shell = await screen.findByRole("dialog", { name: TITLE })
    expect(shell).toHaveTextContent("Loading…")
    expect(screen.getByRole("status", { name: "" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(batch()).not.toBeInTheDocument()
    // Focus goes back to the control that asked, not to the page.
    expect(primary).toHaveFocus()

    // The code arriving afterwards does not open the batch that was cancelled.
    await release()
    expect(batch()).not.toBeInTheDocument()
  })

  it("shows the real dialog once the code has arrived", async () => {
    const user = userEvent.setup()
    renderBar()
    await release()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    const dialog = await screen.findByRole("dialog", { name: TITLE })
    // The real batch, not the shell: its own controls are there.
    expect(dialog).not.toHaveTextContent("Loading…")
    expect(
      await screen.findByRole("button", { name: /^Create \d+ drafts?$/ })
    ).toBeInTheDocument()
  })
})
