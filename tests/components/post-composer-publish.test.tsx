import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostComposerSheet } from "@/components/locations/posts/post-composer-sheet"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { Post } from "@/lib/api/location-posts"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"

const api = vi.hoisted(() => ({
  createPost: vi.fn(),
  updatePost: vi.fn(),
  publishPost: vi.fn(),
}))
vi.mock("@/lib/api/location-posts", () => api)

const mediaItems = vi.hoisted(() => ({
  items: [
    {
      id: "m1",
      googleMediaName: "media/1",
      ownership: "merchant",
      mediaFormat: "PHOTO",
      category: "ADDITIONAL",
      sourceUrl: null,
      googleUrl: "https://lh3.googleusercontent.com/one",
      thumbnailUrl: "https://lh3.googleusercontent.com/one=s200",
      description: "The bar",
    },
  ],
}))
vi.mock("@/lib/queries/use-location-media", () => ({
  useMedia: () => ({
    data: {
      items: mediaItems.items,
      categories: ["ADDITIONAL"],
      paging: {},
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

function savedPost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Open late",
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
    ...overrides,
  }
}

const PUBLISHER = {
  canPublish: true,
  canEditCanonical: true,
} as LocationCapabilities
const EDITOR = {
  canPublish: false,
  canEditCanonical: true,
} as LocationCapabilities

function renderComposer(
  props: Partial<React.ComponentProps<typeof PostComposerSheet>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PostComposerSheet
          locationId="loc-1"
          disabledReason={null}
          caps={PUBLISHER}
          writesEnabled
          {...props}
        />
      </Toaster>
    </QueryClientProvider>
  )
}

async function openAndWrite(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New post" }))
  const sheet = await screen.findByRole("dialog")
  await user.type(
    within(sheet).getByRole("textbox", { name: "Post summary" }),
    "Late opening on Friday"
  )
  return sheet
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})
afterEach(() => vi.clearAllMocks())

describe("PostComposerSheet publishing", () => {
  it("publishes from the footer in two taps, with no separate confirm dialog", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({ post: { id: "p-new" } })
    api.publishPost.mockResolvedValue({
      status: "published",
      operation: { outcome: "confirmed_applied" },
    })
    renderComposer()
    const sheet = await openAndWrite(user)

    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )

    await waitFor(() => expect(api.publishPost).toHaveBeenCalledOnce())
    expect(api.createPost).toHaveBeenCalledOnce()
    expect(api.publishPost.mock.calls[0][1]).toBe("p-new")
    // Created first, then published: never published before it is saved.
    expect(api.createPost.mock.invocationCallOrder[0]).toBeLessThan(
      api.publishPost.mock.invocationCallOrder[0]
    )
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(await screen.findByText("Post live on Google")).toBeInTheDocument()
  })

  it("draws the consent line whenever Publish to Google is on screen", async () => {
    const user = userEvent.setup()
    renderComposer()
    const sheet = await openAndWrite(user)
    const publish = within(sheet).getByRole("button", {
      name: "Publish to Google",
    })
    const consent = within(sheet).getByText(
      /Publish to Google sends this update to your Google listing now/
    )
    expect(consent).toBeVisible()
    expect(publish).toHaveAccessibleDescription(consent.textContent ?? "")
  })

  it("names the photo in the consent line once one is chosen, and sends it with the post", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({ post: { id: "p-new" } })
    api.publishPost.mockResolvedValue({ status: "published" })
    renderComposer()
    const sheet = await openAndWrite(user)
    expect(within(sheet).queryByText(/with its photo/)).toBeNull()

    await user.click(within(sheet).getByRole("button", { name: "Add photo" }))
    await user.click(
      await screen.findByRole("button", { name: "Use photo: The bar" })
    )

    expect(within(sheet).getByText(/with its photo/)).toBeVisible()
    expect(within(sheet).getByText("Photo for this post")).toBeVisible()
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(api.createPost).toHaveBeenCalledOnce())
    expect(api.createPost.mock.calls[0][1].media).toEqual([
      { sourceUrl: "https://lh3.googleusercontent.com/one" },
    ])
  })

  it("asks for approval, and says nothing reaches Google, when the person cannot publish", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({ post: { id: "p-new" } })
    api.publishPost.mockResolvedValue({ status: "awaiting_approval" })
    renderComposer({ caps: EDITOR })
    const sheet = await openAndWrite(user)
    expect(
      within(sheet).queryByRole("button", { name: "Publish to Google" })
    ).toBeNull()
    expect(
      within(sheet).getByText(/Nothing reaches Google until they approve it/)
    ).toBeVisible()
    await user.click(
      within(sheet).getByRole("button", { name: "Request approval" })
    )
    await waitFor(() => expect(api.publishPost).toHaveBeenCalledOnce())
    expect(
      await screen.findByText("Post submitted for approval.")
    ).toBeInTheDocument()
  })

  it("keeps the draft and says so when the publish fails after the save", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({ post: { id: "p-new" } })
    api.publishPost.mockRejectedValue(
      new ApiClientError(422, "validation_failed", "Google refused the post.")
    )
    renderComposer()
    const sheet = await openAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(api.publishPost).toHaveBeenCalledOnce())
    expect(
      await screen.findByText(/kept in NabaPresence, not lost/)
    ).toBeInTheDocument()
    expect(api.createPost).toHaveBeenCalledOnce()
  })

  it("does not claim the post is only a draft when the answer was lost", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({ post: { id: "p-new" } })
    api.publishPost.mockRejectedValue(new TypeError("Failed to fetch"))
    renderComposer()
    const sheet = await openAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(api.publishPost).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(document.querySelector('[data-type="error"]')).not.toBeNull()
    )
    expect(screen.queryByText(/kept in NabaPresence/)).toBeNull()
    expect(screen.queryByText(/saved as a draft/i)).toBeNull()
  })

  it("saves an edited draft against its revision, then publishes it", async () => {
    const user = userEvent.setup()
    api.updatePost.mockResolvedValue({ post: { id: "p1" } })
    api.publishPost.mockResolvedValue({ status: "published" })
    renderComposer({ post: savedPost() })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const sheet = await screen.findByRole("dialog")
    await user.type(
      within(sheet).getByRole("textbox", { name: "Post summary" }),
      " tonight"
    )
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(api.publishPost).toHaveBeenCalledOnce())
    expect(api.updatePost.mock.calls[0][1]).toBe("p1")
    expect(api.updatePost.mock.calls[0][3]).toBe("2026-08-01T00:00:00.000Z")
    expect(api.createPost).not.toHaveBeenCalled()
  })

  it("publishes an unchanged saved draft as it is, without saving it again", async () => {
    const user = userEvent.setup()
    api.publishPost.mockResolvedValue({ status: "published" })
    renderComposer({ post: savedPost() })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const sheet = await screen.findByRole("dialog")
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(api.publishPost).toHaveBeenCalledOnce())
    expect(api.updatePost).not.toHaveBeenCalled()
    expect(api.createPost).not.toHaveBeenCalled()
  })

  it("names Retry publish in the consent line for a failed post", async () => {
    const user = userEvent.setup()
    renderComposer({ post: savedPost({ status: "failed" }) })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByRole("button", { name: "Retry publish" })
    ).toBeEnabled()
    expect(within(sheet).getByText(/^Retry publish sends this/)).toBeVisible()
  })

  it("explains why Publish is off, on the button itself, when publishing is paused", async () => {
    const user = userEvent.setup()
    renderComposer({ writesEnabled: false })
    const sheet = await openAndWrite(user)
    const publish = within(sheet).getByRole("button", {
      name: "Publish to Google",
    })
    expect(publish).toHaveAccessibleDescription(
      /Publishing to Google is currently unavailable/
    )
    expect(
      within(sheet).getByText(/Publish to Google sends this update/)
    ).toBeVisible()
  })

  it("asks for text before publishing an empty post, and sends nothing", async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.click(screen.getByRole("button", { name: "New post" }))
    const sheet = await screen.findByRole("dialog")
    // Nothing changed yet: publishing is off until the post is written.
    expect(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    ).toBeDisabled()
    expect(api.createPost).not.toHaveBeenCalled()
  })

  it("only saves drafts when it is not told what the person may do", async () => {
    const user = userEvent.setup()
    renderComposer({ caps: undefined })
    const sheet = await openAndWrite(user)
    expect(
      within(sheet).queryByRole("button", { name: "Publish to Google" })
    ).toBeNull()
    expect(within(sheet).queryByText(/Publish to Google sends/)).toBeNull()
    expect(
      within(sheet).getByRole("button", { name: "Save draft" })
    ).toBeEnabled()
  })
})
