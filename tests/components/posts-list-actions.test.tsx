import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { PostCard } from "@/components/locations/posts/post-card"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { Post } from "@/lib/api/location-posts"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"

// p4-F06: acting on a post from the list. Consent that is true for every
// answer, a decision named for what it does, focus kept on the post, and
// waiting shown as status.

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

const OWNER: LocationCapabilities = { canEditCanonical: true, canPublish: true }
const MEMBER: LocationCapabilities = {
  canEditCanonical: false,
  canPublish: false,
  canEdit: true,
  canRequestApproval: true,
  canDecideApproval: false,
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Open late tonight",
    callToAction: null,
    event: null,
    offer: null,
    media: [],
    status: "draft",
    googlePostName: null,
    googleState: null,
    googleSearchUrl: null,
    lastErrorCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    contentRevision: 3,
    ...overrides,
  }
}

type BarProps = Parameters<typeof PostsActionBar>[0]

// The bar inside its card, as the list draws it, so the heading focus
// returns to is on the page.
function renderRow(props: Partial<BarProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const row = props.post ?? post()
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PostCard
          id={row.id}
          title="Open late tonight"
          summary=""
          status="Draft"
          tone="neutral"
          actions={
            <PostsActionBar
              locationId="loc-1"
              post={row}
              caps={OWNER}
              writesEnabled
              {...props}
            />
          }
        />
      </Toaster>
    </QueryClientProvider>
  )
}
const heading = () => screen.getByRole("heading", { name: "Open late tonight" })

afterEach(() => vi.clearAllMocks())

describe("publish consent", () => {
  it("says the publish may wait for a second approver, before anything is sent", async () => {
    renderRow()
    await userEvent.click(screen.getByRole("button", { name: "Publish" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveAccessibleName("Publish this post to Google?")
    expect(dialog).toHaveAccessibleDescription(
      /If your organisation needs a second approver, it waits for them first and nothing goes to Google yet\./
    )
    expect(within(dialog).queryByText(/The last attempt/)).toBeNull()
    expect(api.publishPost).not.toHaveBeenCalled()
  })

  it("asks to publish a failed post again and says a retry adds no second post", async () => {
    api.publishPost.mockResolvedValue({ status: "published", postId: "p1" })
    renderRow({ post: post({ status: "failed" }) })
    await userEvent.click(screen.getByRole("button", { name: "Retry publish" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveAccessibleName("Publish this post to Google again?")
    expect(
      within(dialog).getByText(
        "The last attempt didn’t go live, so sending it again won’t make a second post."
      )
    ).toBeInTheDocument()
    // The same publish, bound to the same revision.
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() =>
      expect(api.publishPost).toHaveBeenCalledWith("loc-1", "p1", {
        intentId: expect.any(String),
        expectedRevision: 3,
      })
    )
  })
})

describe("focus after an action", () => {
  it("returns focus to the post's heading after a publish", async () => {
    api.publishPost.mockResolvedValue({ status: "published", postId: "p1" })
    renderRow()
    await userEvent.click(screen.getByRole("button", { name: "Publish" }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Publish to Google",
      })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it("returns focus to the opener when the publish dialog is dismissed", async () => {
    renderRow()
    const publish = screen.getByRole("button", { name: "Publish" })
    await userEvent.click(publish)
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Not yet",
      })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(publish))
  })

  it("returns focus to the heading after Request approval, whose button goes", async () => {
    api.publishPost.mockResolvedValue({ status: "awaiting_approval" })
    renderRow({ caps: MEMBER })
    await userEvent.click(
      screen.getByRole("button", { name: "Request approval" })
    )
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it("returns focus to the heading after an approval", async () => {
    api.decidePostApproval.mockResolvedValue({
      status: "published",
      postId: "p1",
      googlePostName: null,
    })
    renderRow({ post: post({ status: "awaiting_approval" }) })
    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Approve and publish",
      })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })
})

describe("sending a request back", () => {
  it("names the decision for what it does, shows it working, then returns focus", async () => {
    let answer: (value: unknown) => void = () => {}
    api.decidePostApproval.mockImplementation(
      () => new Promise((resolve) => (answer = resolve))
    )
    renderRow({ post: post({ status: "awaiting_approval" }) })
    await userEvent.click(
      screen.getByRole("button", { name: /^More actions for / })
    )
    const menu = await screen.findByRole("menu")
    expect(within(menu).queryByRole("menuitem", { name: /^Reject/ })).toBeNull()
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Send back to draft" })
    )
    // The menu has closed; the row says it is working.
    expect(await screen.findByText("Sending back to draft…")).toHaveAttribute(
      "role",
      "status"
    )
    // The same decision call, bound to the revision on screen.
    expect(api.decidePostApproval).toHaveBeenCalledWith(
      "loc-1",
      "p1",
      "reject",
      3,
      { intentId: expect.any(String) }
    )
    answer({ status: "draft" })
    expect(await screen.findByText("Sent back to draft")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText("Sending back to draft…")).toBeNull()
    )
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })
})

describe("waiting for an approver", () => {
  it("shows waiting as status, not a disabled Approve, when the reason is authority", async () => {
    renderRow({ post: post({ status: "awaiting_approval" }), caps: MEMBER })
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(
      screen.getByText(
        "Waiting for an approver. Only someone who can publish this location can approve it."
      )
    ).toBeInTheDocument()
    // The decision is still gated, with its reason, in the menu.
    await userEvent.click(
      screen.getByRole("button", { name: /^More actions for / })
    )
    expect(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: /^Send back to draft/,
      })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it("keeps a disabled Approve with its reason while posts are paused", () => {
    renderRow({
      post: post({ status: "awaiting_approval" }),
      writesEnabled: false,
    })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(
      screen.getByText("Publishing to Google is currently unavailable.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Waiting for an approver/)).toBeNull()
  })

  it("keeps a disabled Approve with its reason when billing is read-only", () => {
    renderRow({
      post: post({ status: "awaiting_approval" }),
      caps: { ...MEMBER, canWrite: false },
    })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(screen.queryByText(/^Waiting for an approver/)).toBeNull()
  })

  it("keeps a disabled Approve when the server pauses posts by resource", () => {
    renderRow({
      post: post({ status: "awaiting_approval" }),
      caps: {
        ...MEMBER,
        resources: {
          posts: { state: "blocked", reasonCode: "publishing_paused" },
        },
      },
    })
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(screen.queryByText(/^Waiting for an approver/)).toBeNull()
  })
})

describe("a delete that fails", () => {
  it("keeps the dialog open and says why inside it, then clears on success", async () => {
    api.deletePost.mockRejectedValueOnce(
      new ApiClientError(404, "post_not_found", "raw server text")
    )
    api.deletePost.mockResolvedValueOnce({ status: "deleted" })
    renderRow()
    await userEvent.click(
      screen.getByRole("button", { name: /^More actions for / })
    )
    await userEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: /^Delete/,
      })
    )
    const dialog = await screen.findByRole("alertdialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" })
    )
    // Said inside the dialog, not announced again: the toast already spoke.
    expect(
      await within(dialog).findByText(
        "That post could not be found. It may have been removed."
      )
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole("alert")).toBeNull()
    expect(screen.getByRole("alertdialog")).toBe(dialog)
    expect(dialog).not.toHaveTextContent("raw server text")

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.deletePost).toHaveBeenCalledTimes(2)
  })

  it("starts a reopened delete dialog without the last error", async () => {
    api.deletePost.mockRejectedValueOnce(
      new ApiClientError(404, "post_not_found", "raw")
    )
    renderRow()
    const openDelete = async () => {
      await userEvent.click(
        screen.getByRole("button", { name: /^More actions for / })
      )
      await userEvent.click(
        within(await screen.findByRole("menu")).getByRole("menuitem", {
          name: /^Delete/,
        })
      )
      return screen.findByRole("alertdialog")
    }
    let dialog = await openDelete()
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" })
    )
    await within(dialog).findByText(
      "That post could not be found. It may have been removed."
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Keep it" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    dialog = await openDelete()
    expect(
      within(dialog).queryByText(
        "That post could not be found. It may have been removed."
      )
    ).toBeNull()
  })
})
