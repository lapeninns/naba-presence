import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { BulkCompose } from "@/components/bulk/bulk-compose"

const A = "00000000-0000-4000-8000-0000000000d1"
const B = "00000000-0000-4000-8000-0000000000d2"
const NEW_ID = "00000000-0000-4000-8000-0000000000b9"
const TOKEN = "a".repeat(64)

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(`ids=${A},${B}`),
}))
vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => "owner",
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({
    data: [
      { id: A, name: "Old Crown" },
      { id: B, name: "White Horse" },
    ],
  }),
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const WARNING = "The post uses repeated punctuation. Check the tone."
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
const previewBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/api/listings/bulk/preview"))
    .map(([, init]) => JSON.parse(String(init?.body)))

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/api/listings/bulk/preview")) {
      const body = JSON.parse(String(init?.body))
      // The server's answer (lib/server/bulk-families/posts.ts): the
      // warnings and the token until the post carries that token.
      return body.items[0].post.contentWarningAcknowledgement === TOKEN
        ? json({ operation: { id: NEW_ID } }, 400)
        : json(
            {
              error: "content_warning_acknowledgement_required",
              message:
                "Read and acknowledge the content warnings before continuing.",
              details: {
                item: 0,
                contentWarningAcknowledgement: TOKEN,
                reasons: [
                  {
                    code: "content_punctuation",
                    severity: "warn",
                    message: WARNING,
                  },
                ],
              },
            },
            409
          )
    }
    if (url.startsWith("/api/assets?status=ready")) return json({ assets: [] })
    return json({ error: "not_found" }, 404)
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

async function writePost(
  user: ReturnType<typeof userEvent.setup>,
  text: string
) {
  await user.click(screen.getByRole("combobox", { name: "What to change" }))
  await user.click(await screen.findByRole("option", { name: "Post draft" }))
  const field = screen.getByLabelText("Post text")
  await user.clear(field)
  await user.type(field, text)
}

describe("BulkCompose content warnings (S4)", () => {
  it("shows a post draft's warnings and sends the consent only once acknowledged", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await writePost(user, "Quiz night tonight!!!")
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    expect(await screen.findByText(WARNING)).toBeInTheDocument()
    expect(previewBodies()).toHaveLength(1)
    expect(previewBodies()[0].items[0].post).not.toHaveProperty(
      "contentWarningAcknowledgement"
    )
    // Not a failure: no error is shown beside the batch.
    expect(screen.queryByRole("alert")).toBeNull()

    // Without the acknowledgement the preview is refused again.
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    await vi.waitFor(() => expect(previewBodies()).toHaveLength(2))
    expect(previewBodies()[1].items[0].post).not.toHaveProperty(
      "contentWarningAcknowledgement"
    )

    await user.click(
      screen.getByRole("checkbox", {
        name: /I have reviewed these content warnings/,
      })
    )
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    await vi.waitFor(() => expect(previewBodies()).toHaveLength(3))
    expect(previewBodies()[2].items[0]).toEqual({
      operation: "post_draft",
      post: {
        topicType: "STANDARD",
        summary: "Quiz night tonight!!!",
        languageCode: "en-GB",
        media: [],
        contentWarningAcknowledgement: TOKEN,
      },
    })
  })

  it("drops the warnings and the consent once the post text changes", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await writePost(user, "Quiz night tonight!!!")
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    await user.click(
      await screen.findByRole("checkbox", {
        name: /I have reviewed these content warnings/,
      })
    )
    await user.type(screen.getByLabelText("Post text"), " Book now!!!")
    expect(screen.queryByText(WARNING)).toBeNull()
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    await vi.waitFor(() => expect(previewBodies()).toHaveLength(2))
    expect(previewBodies()[1].items[0].post).not.toHaveProperty(
      "contentWarningAcknowledgement"
    )
  })

  it("says why a post fails the content checks", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/api/listings/bulk/preview")
        ? json(
            {
              error: "content_checks_failed",
              message: "Update the content before saving or publishing.",
              details: {
                item: 0,
                reasons: [
                  {
                    code: "content_phone",
                    severity: "fail",
                    message: "Remove phone numbers from the post.",
                  },
                ],
              },
            },
            422
          )
        : json({ assets: [] })
    )
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await writePost(user, "Call 01223 456789 to book")
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    expect(
      await screen.findByText("Remove phone numbers from the post.")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("checkbox", {
        name: /I have reviewed these content warnings/,
      })
    ).toBeNull()
  })
})
