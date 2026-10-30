import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { Post } from "@/lib/api/location-posts"

const api = vi.hoisted(() => ({
  publishPost: vi.fn(),
  decidePostApproval: vi.fn(),
  deletePost: vi.fn(),
  fetchPosts: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
}))
vi.mock("@/lib/api/location-posts", () => api)
vi.mock("@/lib/api/mutations", () => ({ fetchMutationReceipt: vi.fn() }))

const TOKEN = "b".repeat(64)
const WARNING = "The post is written in all capitals."

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "OPEN LATE TONIGHT",
    callToAction: null,
    event: null,
    offer: null,
    media: [],
    status: "awaiting_approval",
    contentRevision: 4,
    googlePostName: null,
    googleState: null,
    googleSearchUrl: null,
    lastErrorCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderBar(row: Post = post()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const ui = (value: Post) => (
    <QueryClientProvider client={client}>
      <Toaster>
        <PostsActionBar
          locationId="loc-1"
          post={value}
          caps={{ canEditCanonical: true, canPublish: true }}
          writesEnabled
        />
      </Toaster>
    </QueryClientProvider>
  )
  const view = render(ui(row))
  return { rerender: (value: Post) => view.rerender(ui(value)) }
}

const warningError = () =>
  new ApiClientError(
    409,
    "content_warning_acknowledgement_required",
    "Read and acknowledge the content warnings before continuing.",
    {
      contentWarningAcknowledgement: TOKEN,
      reasons: [{ code: "content_caps", severity: "warn", message: WARNING }],
    }
  )

afterEach(() => vi.clearAllMocks())

describe("PostsActionBar approval after a content policy change (S4)", () => {
  it("shows the refreshed warnings in the dialog and approves with the approver's consent", async () => {
    api.decidePostApproval
      .mockRejectedValueOnce(warningError())
      .mockResolvedValueOnce({
        status: "published",
        postId: "p1",
        googlePostName: "locations/1/localPosts/9",
      })
    renderBar()

    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    const dialog = await screen.findByRole("alertdialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Approve and publish" })
    )
    // The dialog stays open with the warnings as they stand now.
    expect(await within(dialog).findByText(WARNING)).toBeInTheDocument()
    expect(api.decidePostApproval).toHaveBeenCalledTimes(1)
    expect(api.decidePostApproval.mock.calls[0][4]).not.toHaveProperty(
      "contentWarningAcknowledgement"
    )
    const approve = within(dialog).getByRole("button", {
      name: "Approve and publish",
    })
    expect(approve).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(approve)
    expect(api.decidePostApproval).toHaveBeenCalledTimes(1)

    await userEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I have reviewed these content warnings.",
      })
    )
    await userEvent.click(approve)
    expect(await screen.findByText("Post sent to Google")).toBeInTheDocument()
    expect(api.decidePostApproval).toHaveBeenLastCalledWith(
      "loc-1",
      "p1",
      "approve",
      4,
      { intentId: expect.any(String), contentWarningAcknowledgement: TOKEN }
    )
  })

  it("drops the warnings and the consent once the post moves to another revision", async () => {
    api.decidePostApproval.mockRejectedValue(warningError())
    const view = renderBar()
    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    const dialog = await screen.findByRole("alertdialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Approve and publish" })
    )
    await userEvent.click(
      await within(dialog).findByRole("checkbox", {
        name: "I have reviewed these content warnings.",
      })
    )
    view.rerender(post({ contentRevision: 5, summary: "OPEN LATE TODAY" }))
    expect(within(dialog).queryByText(WARNING)).toBeNull()
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Approve and publish" })
    )
    expect(api.decidePostApproval).toHaveBeenLastCalledWith(
      "loc-1",
      "p1",
      "approve",
      5,
      { intentId: expect.any(String) }
    )
  })

  it("closes the dialog for any other refusal", async () => {
    api.decidePostApproval.mockRejectedValueOnce(
      new ApiClientError(422, "content_checks_failed", "Update the content.", {
        reasons: [{ code: "content_url", severity: "fail", message: "No." }],
      })
    )
    renderBar()
    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    const dialog = await screen.findByRole("alertdialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Approve and publish" })
    )
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})
