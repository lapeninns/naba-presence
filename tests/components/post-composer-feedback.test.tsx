import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostComposerSheet } from "@/components/locations/posts/post-composer-sheet"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { Post } from "@/lib/api/location-posts"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import { queryKeys } from "@/lib/queries/keys"

const api = vi.hoisted(() => ({
  createPost: vi.fn(),
  updatePost: vi.fn(),
  publishPost: vi.fn(),
}))
vi.mock("@/lib/api/location-posts", () => api)

vi.mock("@/lib/queries/use-location-media", () => ({
  useMedia: () => ({
    data: { items: [], categories: ["ADDITIONAL"], paging: {} },
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

function renderComposer(
  props: Partial<React.ComponentProps<typeof PostComposerSheet>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const tree = (
    next: Partial<React.ComponentProps<typeof PostComposerSheet>>
  ) => (
    <QueryClientProvider client={client}>
      <Toaster>
        <PostComposerSheet
          locationId="loc-1"
          disabledReason={null}
          caps={PUBLISHER}
          writesEnabled
          {...next}
        />
      </Toaster>
    </QueryClientProvider>
  )
  const view = render(tree(props))
  return {
    invalidate,
    rerender: (next: Partial<React.ComponentProps<typeof PostComposerSheet>>) =>
      view.rerender(tree(next)),
  }
}

async function openNewAndWrite(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New post" }))
  const sheet = await screen.findByRole("dialog")
  await user.type(
    within(sheet).getByRole("textbox", { name: "Post summary" }),
    "Late opening on Friday"
  )
  return sheet
}

async function openEditAndWrite(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit" }))
  const sheet = await screen.findByRole("dialog")
  await user.type(
    within(sheet).getByRole("textbox", { name: "Post summary" }),
    " tonight"
  )
  return sheet
}

function footerOf(sheet: HTMLElement): HTMLElement {
  const footer = sheet.querySelector<HTMLElement>('[data-slot="sheet-footer"]')
  if (!footer) throw new Error("No sheet footer")
  return footer
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("PostComposerSheet feedback", () => {
  it("retries a warning after saving a new post without creating another draft", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({
      post: { id: "p-saved", contentRevision: 1 },
    })
    api.publishPost
      .mockRejectedValueOnce(
        new ApiClientError(
          409,
          "content_warning_acknowledgement_required",
          "Review warnings.",
          {
            contentWarningAcknowledgement: "b".repeat(64),
            reasons: [{ message: "Use sentence case." }],
          }
        )
      )
      .mockResolvedValueOnce({
        status: "published",
        postId: "p-saved",
        googlePostName: "posts/1",
      })
    renderComposer()
    const sheet = await openNewAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await user.click(
      await within(sheet).findByRole("checkbox", {
        name: "I have reviewed these content warnings.",
      })
    )
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(api.publishPost).toHaveBeenCalledTimes(2))
    expect(api.createPost).toHaveBeenCalledOnce()
    expect(api.publishPost.mock.calls[1][1]).toBe("p-saved")
    expect(api.publishPost.mock.calls[1][2]).toMatchObject({
      contentWarningAcknowledgement: "b".repeat(64),
      expectedRevision: 1,
    })
  })

  it("requires a checkbox before resubmitting the server content-warning token", async () => {
    const user = userEvent.setup()
    const token = "a".repeat(64)
    api.createPost
      .mockRejectedValueOnce(
        new ApiClientError(
          409,
          "content_warning_acknowledgement_required",
          "Review the content warnings.",
          {
            contentWarningAcknowledgement: token,
            reasons: [{ message: "Use sentence case." }],
          }
        )
      )
      .mockResolvedValueOnce({ post: { id: "p-new", contentRevision: 1 } })
    renderComposer()
    const sheet = await openNewAndWrite(user)
    await user.click(within(sheet).getByRole("button", { name: "Save draft" }))
    const checkbox = await within(sheet).findByRole("checkbox", {
      name: "I have reviewed these content warnings.",
    })
    expect(checkbox).not.toBeChecked()
    expect(api.createPost).toHaveBeenCalledOnce()
    expect(
      api.createPost.mock.calls[0][1].contentWarningAcknowledgement
    ).toBeUndefined()
    expect(within(sheet).getByText("Use sentence case.")).toBeInTheDocument()
    // The shared block: the warnings as a list in a warning alert, and the
    // acknowledgement outside its live region, saying what to do next.
    const alert = within(sheet)
      .getByText("Use sentence case.")
      .closest<HTMLElement>('[data-slot="alert"]')
    expect(alert).toHaveAttribute("role", "status")
    expect(within(alert!).getByRole("listitem")).toHaveTextContent(
      "Use sentence case."
    )
    expect(alert).not.toContainElement(checkbox)
    expect(checkbox).toHaveAccessibleDescription("Tick this, then save again.")
    // Not a failure: no error toast, and no refusal line beside the button.
    expect(document.querySelector('[data-slot="toast"]')).toBeNull()
    expect(within(sheet).queryByRole("alert")).toBeNull()
    await user.click(checkbox)
    await user.click(within(sheet).getByRole("button", { name: "Save draft" }))
    await waitFor(() => expect(api.createPost).toHaveBeenCalledTimes(2))
    expect(api.createPost.mock.calls[1][1].contentWarningAcknowledgement).toBe(
      token
    )
  })

  it("discards content-warning consent when the post text changes", async () => {
    const user = userEvent.setup()
    api.createPost.mockRejectedValue(
      new ApiClientError(
        409,
        "content_warning_acknowledgement_required",
        "Review the content warnings.",
        {
          contentWarningAcknowledgement: "a".repeat(64),
          reasons: [{ message: "Use sentence case." }],
        }
      )
    )
    renderComposer()
    const sheet = await openNewAndWrite(user)
    await user.click(within(sheet).getByRole("button", { name: "Save draft" }))
    await user.click(
      await within(sheet).findByRole("checkbox", {
        name: "I have reviewed these content warnings.",
      })
    )
    await user.type(
      within(sheet).getByRole("textbox", { name: "Post summary" }),
      " today"
    )
    expect(
      within(sheet).queryByRole("checkbox", {
        name: "I have reviewed these content warnings.",
      })
    ).toBeNull()
    await user.click(within(sheet).getByRole("button", { name: "Save draft" }))
    await waitFor(() => expect(api.createPost).toHaveBeenCalledTimes(2))
    expect(
      api.createPost.mock.calls[1][1].contentWarningAcknowledgement
    ).toBeUndefined()
  })

  it("says nothing was sent, not that permission is missing, when publishing needs the person to confirm it’s them", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({
      post: { id: "p-new", contentRevision: 1 },
    })
    api.publishPost.mockRejectedValue(
      new ApiClientError(403, "mfa_step_up_required", "raw server text")
    )
    renderComposer()
    const sheet = await openNewAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )

    expect(
      await screen.findByText(
        "Publishing needs you to confirm it’s you first, so nothing was sent to Google. The post is kept in NabaPresence: publish it from the list once you’ve confirmed."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/permission/i)).toBeNull()
    expect(screen.queryByText("raw server text")).toBeNull()
    // Saved first, then refused before anything went to Google.
    expect(api.createPost).toHaveBeenCalledOnce()
    expect(api.publishPost).toHaveBeenCalledOnce()
  })

  it("points to setting up two-step verification when it is not set up yet", async () => {
    const user = userEvent.setup()
    api.createPost.mockResolvedValue({
      post: { id: "p-new", contentRevision: 1 },
    })
    api.publishPost.mockRejectedValue(
      new ApiClientError(403, "mfa_enrollment_required", "raw server text")
    )
    renderComposer()
    const sheet = await openNewAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )

    expect(
      await screen.findByText(
        /^Publishing needs two-step verification set up first, so nothing was sent to Google\./
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/permission/i)).toBeNull()
  })

  it("says someone else saved the post, keeps the edits, refetches, and then offers their version", async () => {
    const user = userEvent.setup()
    api.updatePost.mockRejectedValue(
      new ApiClientError(409, "post_changed", "raw server text")
    )
    const post = savedPost()
    const { invalidate, rerender } = renderComposer({ post })
    const sheet = await openEditAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Save changes" })
    )

    await waitFor(() => expect(api.updatePost).toHaveBeenCalledOnce())
    // Sent against the revision that was opened.
    expect(api.updatePost.mock.calls[0][3]).toBe("2026-08-01T00:00:00.000Z")
    const copy =
      "Someone else saved this post while you were editing. Your edits are still here: choose whose version to keep, then save again."
    const alert = within(footerOf(sheet)).getByRole("alert")
    expect(alert).toHaveTextContent(copy)
    expect(screen.queryByText("raw server text")).toBeNull()
    expect(
      within(sheet).getByRole("textbox", { name: "Post summary" })
    ).toHaveValue("Open late tonight")
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.locationPosts("loc-1"),
    })

    // The refetched post is someone else's save: offered, not followed
    // over the edits.
    rerender({
      post: savedPost({
        summary: "Closed on Friday",
        updatedAt: "2026-08-02T00:00:00.000Z",
      }),
    })
    expect(
      await screen.findByText(
        "Someone else saved this post while you were editing"
      )
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole("textbox", { name: "Post summary" })
    ).toHaveValue("Open late tonight")
  })

  it("says the same, and sends nothing to Google, when the save before a publish is stale", async () => {
    const user = userEvent.setup()
    api.updatePost.mockRejectedValue(
      new ApiClientError(409, "post_changed", "raw server text")
    )
    const { invalidate } = renderComposer({ post: savedPost() })
    const sheet = await openEditAndWrite(user)
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )

    await waitFor(() =>
      expect(within(footerOf(sheet)).getByRole("alert")).toHaveTextContent(
        /^Someone else saved this post while you were editing\./
      )
    )
    expect(api.publishPost).not.toHaveBeenCalled()
    expect(sheet).toBeInTheDocument()
    expect(
      within(sheet).getByRole("textbox", { name: "Post summary" })
    ).toHaveValue("Open late tonight")
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.locationPosts("loc-1"),
    })
  })

  it("shows a refused save in the footer, beside the buttons", async () => {
    const user = userEvent.setup()
    api.createPost.mockRejectedValue(
      new ApiClientError(422, "validation_failed", "Google refused the post.")
    )
    renderComposer()
    const sheet = await openNewAndWrite(user)
    await user.click(within(sheet).getByRole("button", { name: "Save draft" }))
    await waitFor(() =>
      expect(within(footerOf(sheet)).getByRole("alert")).toBeInTheDocument()
    )
  })

  it("names Save changes in the footer note when editing", async () => {
    const user = userEvent.setup()
    renderComposer({ post: savedPost() })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByText(
        "Save changes keeps it here only. Google is not affected."
      )
    ).toBeVisible()
    expect(within(sheet).queryByText(/^Save draft/)).toBeNull()
  })

  it("names Save changes in the footer note for a failed post", async () => {
    const user = userEvent.setup()
    renderComposer({ post: savedPost({ status: "failed" }) })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByText(
        "Save changes turns it back into a draft. Nothing reaches Google until you publish it."
      )
    ).toBeVisible()
  })

  it("keeps Save draft in the footer note for a new post", async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.click(screen.getByRole("button", { name: "New post" }))
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByText(
        "Save draft keeps it here only. Google is not affected."
      )
    ).toBeVisible()
  })

  it("describes an untouched Publish by its consent first, then why it is off", async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.click(screen.getByRole("button", { name: "New post" }))
    const sheet = await screen.findByRole("dialog")
    const publish = within(sheet).getByRole("button", {
      name: "Publish to Google",
    })
    const consent = sheet.querySelector('[data-slot="publish-consent"]')
    expect(publish.getAttribute("aria-describedby")?.split(" ")[0]).toBe(
      consent?.id
    )
    expect(publish).toHaveAccessibleDescription(
      `${consent?.textContent ?? ""} Write the post first.`
    )
  })

  it("names the preview once, without a second landmark", async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.click(screen.getByRole("button", { name: "New post" }))
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).queryAllByRole("complementary")).toHaveLength(0)
    expect(
      within(sheet).getByRole("button", { name: "Preview" })
    ).toBeInTheDocument()
  })
})
