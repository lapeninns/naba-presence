import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostComposerSheet } from "@/components/locations/posts/post-composer-sheet"
import { Toaster } from "@/components/ui/toast"
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
    api.publishPost.mockRejectedValue(new Error("boom"))
    renderComposer()
    const sheet = await openAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(api.publishPost).toHaveBeenCalledOnce())
    expect(await screen.findByText(/saved as a draft/i)).toBeInTheDocument()
    expect(api.createPost).toHaveBeenCalledOnce()
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
