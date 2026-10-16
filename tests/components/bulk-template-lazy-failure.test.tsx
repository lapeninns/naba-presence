import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
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

// The template dialog's code cannot be fetched (offline, a retired file).
vi.mock("@/components/inbox/template-reply-dialog", () => ({
  get TemplateReplyDialog() {
    const error = new Error("Loading chunk 7 failed.")
    error.name = "ChunkLoadError"
    throw error
  },
}))

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
  return <BulkActionBar rows={[ratingOnly]} />
}

afterEach(() => vi.restoreAllMocks())

describe("BulkActionBar when the template dialog will not load", () => {
  it("toasts instead of throwing into the page, and leaves the selection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
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
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Toaster>
          <SelectionProvider>
            <Harness />
          </SelectionProvider>
        </Toaster>
      </QueryClientProvider>
    )
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(
      await screen.findByText("Could not open the template reply")
    ).toBeInTheDocument()
    expect(
      screen.getByText("Check your connection and try again.")
    ).toBeInTheDocument()
    // The dialog is closed and the bar is still there to try again.
    expect(
      screen.queryByRole("dialog", { name: "Reply with the rating template" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Loading the template reply…")).toBeNull()
    expect(
      screen.getByRole("region", { name: "Selected reviews" })
    ).toBeInTheDocument()
  })
})
