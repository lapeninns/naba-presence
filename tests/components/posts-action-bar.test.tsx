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
  fetchPosts: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
}))
vi.mock("@/lib/api/location-posts", () => api)
const receipts = vi.hoisted(() => ({ fetchMutationReceipt: vi.fn() }))
vi.mock("@/lib/api/mutations", () => receipts)

const POSTS_KEY = queryKeys.locationPosts("loc-1")
const OWNER: LocationCapabilities = { canEditCanonical: true, canPublish: true }
// A drafting member: may edit and request approval, may not decide or publish.
const MEMBER: LocationCapabilities = {
  canEditCanonical: false,
  canPublish: false,
  canEdit: true,
  canRequestApproval: true,
  canDecideApproval: false,
}
// The flags lib/server/capabilities.ts emits for a viewer.
const VIEWER: LocationCapabilities = {
  canEditCanonical: false,
  canPublish: false,
  canEdit: false,
  canRequestApproval: false,
  canDecideApproval: false,
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1", topicType: "STANDARD", languageCode: "en-GB", summary: "Open late tonight", callToAction: null, event: null, offer: null, media: [],
    status: "draft", googlePostName: null, googleState: null, googleSearchUrl: null, lastErrorCode: null,
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

// Everything but a post's one next step sits in its "More actions" menu.
async function openMore() {
  await userEvent.click(screen.getByRole("button", { name: /^More actions for / }))
  return screen.findByRole("menu")
}
async function menuItem(name: RegExp) {
  const menu = await openMore()
  return within(menu).getByRole("menuitem", { name })
}
function expectDisabled(item: HTMLElement) {
  expect(item).toHaveAttribute("aria-disabled", "true")
}
function expectEnabled(item: HTMLElement) {
  expect(item).not.toHaveAttribute("aria-disabled", "true")
}

describe("PostsActionBar", () => {
  it("publishes a draft, toasts the outcome and invalidates the posts list", async () => {
    api.publishPost.mockResolvedValue({ status: "published", postId: "p1", googlePostName: "locations/1/localPosts/9" })
    const client = renderBar()

    await userEvent.click(screen.getByRole("button", { name: "Publish" }))
    // Nothing is sent until the post has been shown and confirmed.
    const confirm = await screen.findByRole("alertdialog")
    expect(api.publishPost).not.toHaveBeenCalled()
    expect(within(confirm).getByText("Open late tonight")).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole("button", { name: "Publish to Google" }))

    expect(await screen.findByText("Post sent to Google")).toBeInTheDocument()
    expect(api.publishPost).toHaveBeenCalledWith("loc-1", "p1", {
      intentId: expect.any(String),
    })
    expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(true)
  })

  it("shows one action per post and keeps the rest in a named menu", () => {
    renderBar()
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "More actions for Open late tonight" })
    ).toBeInTheDocument()
  })

  it("reports a publish that went to the approval queue", async () => {
    api.publishPost.mockResolvedValue({ status: "awaiting_approval" })
    renderBar({ post: post({ status: "failed" }) })

    // A failed post's publish reads as a retry; it is the same mutation.
    await userEvent.click(screen.getByRole("button", { name: "Retry publish" }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish to Google" })
    )

    expect(await screen.findByText("Post submitted for approval.")).toBeInTheDocument()
  })

  it("offers Edit on drafts and failed posts only, reusing the composer", async () => {
    api.updatePost.mockResolvedValue({ post: { id: "p1", status: "draft" } })
    renderBar({ post: post({ status: "failed" }) })

    await userEvent.click(await menuItem(/^Edit/))
    const sheet = await screen.findByRole("dialog", { name: "Edit post" })
    const text = within(sheet).getByRole("textbox", { name: /summary/i })
    expect(text).toHaveValue("Open late tonight")
    await userEvent.type(text, " and Sunday")
    await userEvent.click(within(sheet).getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(api.updatePost).toHaveBeenCalledTimes(1))
    expect(api.updatePost.mock.calls[0]![1]).toBe("p1")
    expect(api.updatePost.mock.calls[0]![2]).toMatchObject({
      summary: "Open late tonight and Sunday",
      languageCode: "en-GB",
    })
    expect(api.publishPost).not.toHaveBeenCalled()
  })

  it("has no Edit for a post that is live or waiting on someone", async () => {
    renderBar({ post: post({ status: "awaiting_approval" }) })
    const menu = await openMore()
    expect(within(menu).queryByRole("menuitem", { name: /^Edit/ })).toBeNull()
  })

  it("approves and rejects an awaiting-approval post with the matching copy", async () => {
    api.decidePostApproval.mockResolvedValueOnce({ status: "published", postId: "p1", googlePostName: null })
    api.decidePostApproval.mockResolvedValueOnce({ status: "draft" })
    const client = renderBar({
      post: post({ status: "awaiting_approval", contentRevision: 3 }),
    })

    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    // Approving publishes, so the approver sees the post first.
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Approve and publish this post?")).toBeInTheDocument()
    expect(within(dialog).getByText("Preview")).toBeInTheDocument()
    expect(api.decidePostApproval).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and publish" }))
    expect(await screen.findByText("Post sent to Google")).toBeInTheDocument()
    expect(api.decidePostApproval).toHaveBeenCalledWith("loc-1", "p1", "approve", 3)
    expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(true)

    await userEvent.click(await menuItem(/^Reject/))
    expect(await screen.findByText("Sent back to draft")).toBeInTheDocument()
    expect(api.decidePostApproval).toHaveBeenLastCalledWith("loc-1", "p1", "reject", 3)
  })

  it("deletes after confirmation, closes the dialog and invalidates", async () => {
    api.deletePost.mockResolvedValue({ status: "deleted" })
    const client = renderBar()

    // Delete is the menu's last row, and still asks first.
    const menu = await openMore()
    const rows = within(menu).getAllByRole("menuitem")
    expect(rows.at(-1)).toHaveAccessibleName(/^Delete/)
    await userEvent.click(rows.at(-1)!)
    const dialog = await screen.findByRole("alertdialog")
    expect(api.deletePost).not.toHaveBeenCalled()
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
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish to Google" })
    )

    expect(await screen.findByText("A different authorised user must approve this post.")).toBeInTheDocument()
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument()
    expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(false)
  })

  it("disables every control when Google writes are paused", async () => {
    renderBar({ post: post({ status: "awaiting_approval" }), writesEnabled: false })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    const menu = await openMore()
    expectDisabled(within(menu).getByRole("menuitem", { name: /^Reject/ }))
    const remove = within(menu).getByRole("menuitem", { name: /^Delete/ })
    expectDisabled(remove)
    // The reason is on the row in words, not only a greyed-out row.
    expect(remove).toHaveAccessibleDescription(/./)
  })

  it("gates approve and reject on decide_approval but leaves draft delete to the edit grant", async () => {
    renderBar({ post: post({ status: "awaiting_approval" }), caps: MEMBER })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    const menu = await openMore()
    // Rejecting is the same decision as approving: the route answers 403
    // permission_denied without decide_approval.
    expectDisabled(within(menu).getByRole("menuitem", { name: /^Reject/ }))
    // A draft has no Google post, so deleting it needs no publish permission.
    expectEnabled(within(menu).getByRole("menuitem", { name: /^Delete/ }))
  })

  it("lets a decide_approval holder reject even without the posts resource", async () => {
    renderBar({
      post: post({ status: "awaiting_approval" }),
      caps: { ...MEMBER, canPublish: true, canDecideApproval: true, canRequestApproval: false },
    })
    expectEnabled(await menuItem(/^Reject/))
  })

  it("keeps a viewer's draft read-only: no request, edit or delete", async () => {
    renderBar({ caps: VIEWER })
    expect(screen.getByRole("button", { name: "Request approval" })).toBeDisabled()
    expect(screen.getByText("Your role can view this location but not change it.")).toBeInTheDocument()
    const menu = await openMore()
    const edit = within(menu).getByRole("menuitem", { name: /^Edit/ })
    expectDisabled(edit)
    expect(edit).toHaveAccessibleDescription("Your role can view this location but not change it.")
    expectDisabled(within(menu).getByRole("menuitem", { name: /^Delete/ }))
  })

  it("never offers a viewer a decision on someone's request", async () => {
    renderBar({ post: post({ status: "awaiting_approval" }), caps: VIEWER })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    expectDisabled(await menuItem(/^Reject/))
  })

  it("requires publish permission to delete a post that is live on Google", async () => {
    renderBar({
      post: post({ status: "published", googlePostName: "locations/1/localPosts/9", googleSearchUrl: "https://g.test/p" }),
      caps: MEMBER,
    })
    expect(screen.getByRole("link", { name: "View on Google" })).toHaveAttribute("href", "https://g.test/p")
    expectDisabled(await menuItem(/^Delete from Google/))
  })

  it("honours a per-resource capability state over the plain publish gate", () => {
    renderBar({ caps: { ...OWNER, resources: { posts: { state: "readOnly", reasonCode: "publishing_paused" } } } })
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled()
  })

  // The approval half of the post lifecycle had no way in from the product: a
  // non-publisher's Publish is exactly the call that routes to
  // `awaiting_approval`, but the button was gated on the same
  // `publish_not_allowed` the approval flow exists to route around, so it
  // rendered disabled and nobody could ever reach the queue.
  it("offers a non-publisher an enabled Request approval on a draft", async () => {
    api.publishPost.mockResolvedValue({ status: "awaiting_approval" })
    renderBar({ caps: MEMBER })

    const button = screen.getByRole("button", { name: "Request approval" })
    expect(button).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument()

    await userEvent.click(button)
    expect(await screen.findByText("Post submitted for approval.")).toBeInTheDocument()
    expect(api.publishPost).toHaveBeenCalledWith("loc-1", "p1", {
      intentId: expect.any(String),
    })
  })

  it("keeps the pause switch over Request approval", () => {
    renderBar({ caps: MEMBER, writesEnabled: false })
    expect(screen.getByRole("button", { name: "Request approval" })).toBeDisabled()
  })

  it("never tells the operator to use Check Google on a post that is still publishing", async () => {
    renderBar({ post: post({ status: "publishing" }) })
    expect(screen.queryByRole("button", { name: "Check Google" })).not.toBeInTheDocument()
    await userEvent.click(await menuItem(/^Delete/))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("This deletes the post from NabaPresence.")).toBeInTheDocument()
    expect(within(dialog).getByText(/This post is still being sent/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Check Google/)).not.toBeInTheDocument()
  })

  it("points an ambiguous post's delete at Check Google, because Google may hold it", async () => {
    renderBar({ post: post({ status: "ambiguous" }) })
    await userEvent.click(await menuItem(/^Delete/))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/use Check Google first to find out/)).toBeInTheDocument()
  })

  // An ambiguous post's Google name is unknown, so a republish would be a blind
  // `create` and Google would end up holding the same update twice. Reading
  // Google back is the only safe next move, and it must be the only offer.
  it("offers only Check Google on an ambiguous post, never Publish", async () => {
    api.fetchPosts.mockResolvedValue([post({ status: "published", googlePostName: "locations/1/localPosts/9" })])
    const client = renderBar({ post: post({ status: "ambiguous", lastErrorCode: "publish_lease_expired" }) })

    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Request approval" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Check Google" }))

    // It asks after this post alone: the list is paged, and the post may not
    // be on the first page.
    expect(api.fetchPosts).toHaveBeenCalledWith("loc-1", { post: "p1" })
    await waitFor(() => expect(client.getQueryState(POSTS_KEY)?.isInvalidated).toBe(true))
  })

  describe("publish outcomes", () => {
    async function publishFromDialog() {
      await userEvent.click(screen.getByRole("button", { name: "Publish" }))
      const confirm = await screen.findByRole("alertdialog")
      await userEvent.click(within(confirm).getByRole("button", { name: "Publish to Google" }))
    }

    it("says live only when the route's outcome is confirmed_applied", async () => {
      api.publishPost.mockResolvedValue({
        status: "published",
        postId: "p1",
        googlePostName: "locations/1/localPosts/9",
        operation: { operationId: "op-1", outcome: "confirmed_applied" },
      })
      renderBar()
      await publishFromDialog()
      expect(await screen.findByText("Post live on Google")).toBeInTheDocument()
    })

    it("does not say live while Google is still reviewing the post", async () => {
      api.publishPost.mockResolvedValue({
        status: "published",
        postId: "p1",
        googlePostName: "locations/1/localPosts/9",
        operation: { operationId: "op-1", outcome: "awaiting_confirmation" },
      })
      renderBar()
      await publishFromDialog()
      expect(await screen.findByText("Post sent to Google")).toBeInTheDocument()
      expect(screen.queryByText(/live on Google/i)).toBeNull()
    })

    it("follows the receipt of an ambiguous publish, and resends its intent on retry", async () => {
      const intentIds: string[] = []
      api.publishPost.mockImplementation(async (_l: string, _p: string, options: { intentId: string }) => {
        intentIds.push(options.intentId)
        throw new ApiClientError(502, "google_mutation_ambiguous", "unclear", undefined, {
          intentId: options.intentId,
        })
      })
      receipts.fetchMutationReceipt.mockResolvedValue({
        id: "op-1",
        intentId: "x",
        surface: "local_post",
        action: "create",
        locationId: "loc-1",
        targetType: "local_post",
        targetRef: "p1",
        outcome: "uncertain",
        errorCode: null,
        attemptId: "a1",
        createdAt: "2026-10-10T10:00:00.000Z",
        updatedAt: "2026-10-10T10:00:00.000Z",
      })
      renderBar()
      await publishFromDialog()
      const notice = await screen.findByRole("status")
      expect(notice).toHaveAttribute("data-outcome", "uncertain")
      expect(notice).not.toHaveTextContent("Live on Google")
      await waitFor(() => expect(receipts.fetchMutationReceipt).toHaveBeenCalledWith(intentIds[0], expect.anything()))

      await publishFromDialog()
      await waitFor(() => expect(intentIds).toHaveLength(2))
      expect(intentIds[1]).toBe(intentIds[0])
    })

    // A dropped connection rejects fetch() with a bare TypeError: the most
    // common lost answer, and the one the receipt notice exists for.
    it("follows the receipt when the connection drops mid-publish", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/api/location-posts")
      >("@/lib/api/location-posts")
      api.publishPost.mockImplementation(actual.publishPost)
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new TypeError("Failed to fetch"))
      receipts.fetchMutationReceipt.mockResolvedValue({
        id: "op-1",
        intentId: "x",
        surface: "local_post",
        action: "create",
        locationId: "loc-1",
        targetType: "local_post",
        targetRef: "p1",
        outcome: "uncertain",
        errorCode: null,
        attemptId: "a1",
        createdAt: "2026-10-10T10:00:00.000Z",
        updatedAt: "2026-10-10T10:00:00.000Z",
      })
      renderBar()
      await publishFromDialog()
      const notice = await screen.findByRole("status")
      expect(notice).toHaveAttribute("data-outcome", "uncertain")
      const sent = new Headers(fetchSpy.mock.calls[0][1]?.headers).get(
        "Idempotency-Key"
      )
      expect(sent).toEqual(expect.any(String))
      await waitFor(() =>
        expect(receipts.fetchMutationReceipt).toHaveBeenCalledWith(
          sent,
          expect.anything()
        )
      )
      fetchSpy.mockRestore()
    })
  })
})
