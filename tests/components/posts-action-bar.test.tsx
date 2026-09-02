import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { Post } from "@/lib/api/location-posts"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import { queryKeys } from "@/lib/queries/keys"

const api = vi.hoisted(() => ({
  publishPost: vi.fn(),
  decidePostApproval: vi.fn(),
  deletePost: vi.fn(),
}))
vi.mock("@/lib/api/location-posts", () => api)

const POSTS_KEY = queryKeys.locationPosts("loc-1")
const OWNER: LocationCapabilities = { canEditCanonical: true, canPublish: true }
const MEMBER: LocationCapabilities = { canEditCanonical: false, canPublish: false }

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1", topicType: "STANDARD", languageCode: "en-GB", summary: "Open late tonight", callToAction: null, event: null, offer: null, media: [],
    scheduledTime: null, status: "draft", googlePostName: null, googleState: null, googleSearchUrl: null, lastErrorCode: null,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...overrides,
  }
}

type BarProps = Parameters<typeof PostsActionBar>[0]

function renderBar(props: Partial<BarProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Seed the list query so invalidation is observable.
  client.setQueryData(POSTS_KEY, { seeded: true })
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PostsActionBar locationId="loc-1" post={post()} caps={OWNER} writesEnabled {...props} />
      </Toaster>
    </QueryClientProvider>
  )
  return client
}

afterEach(() => vi.clearAllMocks())

describe("PostsActionBar", () => {
  it("publishes a draft, toasts the outcome and invalidates the posts list", async () => {
    api.publishPost.mockResolvedValue({ status: "published", postId: "p1", googlePostName: "locations/1/localPosts/9" })
    const client = renderBar()

    await userEvent.click(screen.getByRole("button", { name: "Publish" }))

    expect(await screen.findByText("Post published to Google")).toBeInTheDocument()
    expect(api.publishPost).toHaveBeenCalledWith("loc-1", "p1")
    expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(true)
  })

  it("reports a publish that went to the approval queue", async () => {
    api.publishPost.mockResolvedValue({ status: "awaiting_approval" })
    renderBar({ post: post({ status: "failed" }) })

    await userEvent.click(screen.getByRole("button", { name: "Publish" }))

    expect(await screen.findByText("Post submitted for approval.")).toBeInTheDocument()
  })

  it("approves and rejects an awaiting-approval post with the matching copy", async () => {
    api.decidePostApproval.mockResolvedValueOnce({ status: "published", postId: "p1", googlePostName: null })
    api.decidePostApproval.mockResolvedValueOnce({ status: "draft" })
    const client = renderBar({ post: post({ status: "awaiting_approval" }) })

    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(await screen.findByText("Post published to Google")).toBeInTheDocument()
    expect(api.decidePostApproval).toHaveBeenCalledWith("loc-1", "p1", "approve")
    expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(true)

    await userEvent.click(screen.getByRole("button", { name: "Reject" }))
    expect(await screen.findByText("Sent back to draft")).toBeInTheDocument()
    expect(api.decidePostApproval).toHaveBeenLastCalledWith("loc-1", "p1", "reject")
  })

  it("deletes after confirmation, closes the dialog and invalidates", async () => {
    api.deletePost.mockResolvedValue({ status: "deleted" })
    const client = renderBar()

    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("This deletes the draft.")).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Post deleted")).toBeInTheDocument()
    expect(api.deletePost).toHaveBeenCalledWith("loc-1", "p1")
    expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(true)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("uses the posts wording for approval-flow errors and never the raw server text", async () => {
    api.publishPost.mockRejectedValue(new ApiClientError(409, "second_approver_required", "raw server text"))
    const client = renderBar()

    await userEvent.click(screen.getByRole("button", { name: "Publish" }))

    expect(await screen.findByText("A different authorised user must approve this post.")).toBeInTheDocument()
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument()
    expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(false)
  })

  it("disables every control when Google writes are paused", () => {
    renderBar({ post: post({ status: "awaiting_approval" }), writesEnabled: false })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled()
  })

  it("gates live actions on canPublish but leaves reject and draft delete to the pause switch", () => {
    renderBar({ post: post({ status: "awaiting_approval" }), caps: MEMBER })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled()
    // A draft has no Google post, so deleting it needs no publish permission.
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled()
  })

  it("requires publish permission to delete a post that is live on Google", () => {
    renderBar({
      post: post({ status: "published", googlePostName: "locations/1/localPosts/9", googleSearchUrl: "https://g.test/p" }),
      caps: MEMBER,
    })
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled()
    expect(screen.getByRole("link", { name: "View on Google" })).toHaveAttribute("href", "https://g.test/p")
  })

  it("honours a per-resource capability state over the plain publish gate", () => {
    renderBar({ caps: { ...OWNER, resources: { posts: { state: "readOnly", reasonCode: "publishing_paused" } } } })
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled()
  })
})
