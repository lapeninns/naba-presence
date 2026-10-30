import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import { CompletenessCard } from "@/components/listings/completeness-card"
import { ToastProvider } from "@/components/ui/toast"
import * as apiClient from "@/lib/api/client"
import {
  listingCompleteness,
  type CompletenessInput,
  type CompletenessSkip,
  type ListingCompleteness,
} from "@/lib/listings/completeness"

const NOW = new Date("2026-11-15T12:00:00Z")
/** Five days before NOW. */
const FRESH = "2026-11-10T09:00:00Z"
const LOC = "l1"

const DESCRIPTION =
  "The Bell at Langham is a family-run village pub on the edge of the Norfolk coast, serving seasonal British cooking, local ales and a proper Sunday roast. Dogs are welcome in the bar, the walled garden catches the afternoon sun, and open fires make winter evenings cosy. Book ahead for weekend lunches and summer evenings."

type ProfileValue = NonNullable<CompletenessInput["profile"]>["value"]

function fullInput(
  overrides: Partial<CompletenessInput> = {},
  profile: Partial<ProfileValue> = {}
): CompletenessInput {
  return {
    locationId: LOC,
    linked: true,
    verified: true,
    profile: {
      value: {
        primaryCategory: "Pub",
        additionalCategories: 2,
        phone: "+44 1328 830000",
        website: "https://www.thebelllangham.co.uk/?utm_source=gbp",
        description: DESCRIPTION,
        ...profile,
      },
      observedAt: FRESH,
    },
    hours: {
      value: {
        regularPeriods: 7,
        specialPeriods: [{ start: "2026-12-24", end: "2026-12-26" }],
      },
      observedAt: FRESH,
    },
    details: { value: { attributes: 12, serviceItems: 0 }, observedAt: FRESH },
    menu: { value: { eligible: true, items: 30 }, observedAt: FRESH },
    posts: { lastPublishedAt: "2026-11-01T10:00:00Z", observedAt: FRESH },
    photos: {
      newestAt: "2026-10-20T10:00:00Z",
      cover: true,
      logo: true,
      observedAt: FRESH,
    },
    booking: { booking: 1, other: 0, observedAt: FRESH },
    reviews: {
      checkedAt: FRESH,
      overdueUnreplied: 0,
      recent: { count: 10, average: 4.5 },
      previous: { count: 10, average: 4.4 },
    },
    siblings: [],
    ...overrides,
  }
}

const SKIP: CompletenessSkip = {
  checkId: "booking_link",
  reason: "We take walk-ins only",
  skippedAt: "2026-11-01T10:00:00Z",
}

/**
 * Four failing checks, given in an order unlike the importance order:
 * a nice-to-have (additional categories), two essentials (phone,
 * verification) and an important one (a recent post). Booking is skipped.
 */
const FAILING: ListingCompleteness = listingCompleteness(
  fullInput(
    {
      verified: false,
      posts: { lastPublishedAt: null, observedAt: FRESH },
    },
    { phone: null, additionalCategories: 0 }
  ),
  [SKIP],
  NOW
)

const ALL_PASSING: ListingCompleteness = listingCompleteness(
  fullInput(),
  [],
  NOW
)

/**
 * Answers the card's requests at the API client: the completeness read and
 * the skip. The query module calls its own fetchers internally, so the spy
 * sits one module down.
 */
function stubApi(
  read: () => Promise<ListingCompleteness | null> = () =>
    Promise.resolve(FAILING)
) {
  return vi.spyOn(apiClient, "apiFetch").mockImplementation((async (
    path: string,
    init?: { method?: string }
  ) => {
    if (path.startsWith("/api/listings/summary")) {
      const data = await read()
      return { completeness: data ? [data] : [] }
    }
    if (
      path.startsWith(`/api/locations/${LOC}/completeness-skips`) &&
      init?.method === "POST"
    )
      return {
        skip: {
          checkId: "phone",
          reason: "x",
          skippedAt: NOW.toISOString(),
          skippedBy: null,
        },
      }
    throw new Error(`Unexpected request: ${path}`)
  }) as unknown as typeof apiClient.apiFetch)
}

function renderCard(props: { linked?: boolean; canManage: boolean }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CompletenessCard
          locationId={LOC}
          linked={props.linked ?? true}
          canManage={props.canManage}
        />
      </ToastProvider>
    </QueryClientProvider>
  )
  return { ...view, client }
}

function group() {
  return screen.getByRole("region", { name: "Completeness" })
}

/** The titles of the main group's rows, top to bottom. */
function rowTitles(titles: string[]) {
  return within(group())
    .getAllByRole("listitem")
    .map(
      (row) => titles.find((title) => row.textContent?.includes(title)) ?? null
    )
}

const TITLES = [
  "Phone number",
  "Verified by Google",
  "A post in the last 30 days",
  "Additional categories",
]

afterEach(() => vi.restoreAllMocks())

describe("CompletenessCard", () => {
  it("lists failing checks most important first, each with its fix and a Skip for an owner", async () => {
    stubApi()
    renderCard({ canManage: true })
    expect(await screen.findByText("Phone number")).toBeInTheDocument()

    expect(rowTitles(TITLES)).toEqual(TITLES)
    expect(within(group()).getByText(/76% complete/)).toBeInTheDocument()

    expect(
      screen.getByRole("link", { name: "Add phone number" })
    ).toHaveAttribute("href", "/listings/l1/profile")
    expect(
      screen.getByRole("link", {
        name: "Start verification: Verified by Google",
      })
    ).toHaveAttribute("href", "/listings/l1/verification")
    expect(
      screen.getByRole("link", {
        name: "Add a post: A post in the last 30 days",
      })
    ).toHaveAttribute("href", "/listings/l1/posts")
    expect(
      screen.getByRole("link", {
        name: "Add categories: Additional categories",
      })
    ).toHaveAttribute("href", "/listings/l1/profile")

    for (const title of TITLES)
      expect(
        screen.getByRole("button", { name: `Skip: ${title}` })
      ).toBeInTheDocument()
    expect(
      screen.queryByText(
        /An owner or admin can skip a check that doesn’t apply/
      )
    ).not.toBeInTheDocument()
  })

  it("shows a member the same rows without Skip or owner-only fixes", async () => {
    stubApi()
    renderCard({ canManage: false })
    expect(await screen.findByText("Phone number")).toBeInTheDocument()

    expect(rowTitles(TITLES)).toEqual(TITLES)
    expect(
      screen.queryByRole("button", { name: /^Skip/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", {
        name: "Start verification: Verified by Google",
      })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Add phone number" })
    ).toHaveAttribute("href", "/listings/l1/profile")
    expect(
      within(group()).getByText(
        /An owner or admin can skip a check that doesn’t apply\./
      )
    ).toBeInTheDocument()
  })

  it("asks for a reason before skipping, then skips with it", async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderCard({ canManage: true })
    await user.click(
      await screen.findByRole("button", { name: "Skip: Phone number" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Skip “Phone number”?",
    })

    await user.click(within(dialog).getByRole("button", { name: "Skip check" }))
    expect(
      await within(dialog).findByText("Say why this check doesn’t apply.")
    ).toBeInTheDocument()
    const posts = () =>
      api.mock.calls.filter(
        ([, init]) => (init as { method?: string } | undefined)?.method
      )
    expect(posts()).toHaveLength(0)

    await user.type(
      within(dialog).getByRole("textbox", { name: "Why doesn’t this apply?" }),
      "We only take calls through the booking line"
    )
    await user.click(within(dialog).getByRole("button", { name: "Skip check" }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]).toEqual([
      "/api/locations/l1/completeness-skips",
      expect.objectContaining({
        method: "POST",
        body: {
          checkId: "phone",
          reason: "We only take calls through the booking line",
        },
      }),
    ])
  })

  it("gives an example reason only where one fits, and a Cancel", async () => {
    stubApi()
    const user = userEvent.setup()
    renderCard({ canManage: true })
    await user.click(
      await screen.findByRole("button", { name: "Skip: Additional categories" })
    )
    let dialog = await screen.findByRole("dialog", {
      name: "Skip “Additional categories”?",
    })
    expect(within(dialog).queryByText(/For example/)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/walk-ins/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    await user.click(
      screen.getByRole("button", { name: "Skip: A post in the last 30 days" })
    )
    dialog = await screen.findByRole("dialog", {
      name: "Skip “A post in the last 30 days”?",
    })
    expect(
      within(dialog).getByText(/For example: “We’re closed for refurbishment/)
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(/walk-ins/)).not.toBeInTheDocument()
  })

  it("shows the skipped checks and their reason, with Count again for an owner", async () => {
    stubApi()
    const user = userEvent.setup()
    renderCard({ canManage: true })
    const others = FAILING.checks.length - TITLES.length
    await user.click(
      await screen.findByRole("button", {
        name: `Show other checks (${others})`,
      })
    )
    const skipped = screen.getByRole("region", { name: "Skipped (1)" })
    expect(within(skipped).getByText("Booking link")).toBeInTheDocument()
    expect(
      within(skipped).getByText(/We take walk-ins only/)
    ).toBeInTheDocument()
    expect(
      within(skipped).getByRole("button", { name: "Count again: Booking link" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Hide other checks" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("shows a member the skip reason but no Count again", async () => {
    stubApi()
    const user = userEvent.setup()
    renderCard({ canManage: false })
    await user.click(
      await screen.findByRole("button", { name: /^Show other checks/ })
    )
    const skipped = screen.getByRole("region", { name: "Skipped (1)" })
    expect(
      within(skipped).getByText(/We take walk-ins only/)
    ).toBeInTheDocument()
    expect(
      within(skipped).queryByRole("button", { name: /Count again/ })
    ).not.toBeInTheDocument()
  })

  it("draws nothing when the listing isn't linked: the overview says so", () => {
    stubApi()
    const { container } = renderCard({ linked: false, canManage: true })
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByRole("region", { name: "Completeness" })
    ).not.toBeInTheDocument()
  })

  it("offers to try again when completeness can't be read", async () => {
    stubApi(() => Promise.reject(new Error("Synthetic completeness failure")))
    renderCard({ canManage: true })
    expect(
      await screen.findByText("Couldn’t check completeness")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("says there is nothing to fix when no check fails", async () => {
    stubApi(() => Promise.resolve(ALL_PASSING))
    renderCard({ canManage: true })
    await screen.findByText("This listing has everything we check for.")
    const rows = within(group()).getAllByRole("listitem")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent("Nothing to fix")
    // Said once: the row, not a "Done" pill or the caption as well.
    expect(within(group()).getAllByText(/Nothing to fix/)).toHaveLength(1)
    expect(within(group()).queryByText("Done")).not.toBeInTheDocument()
    expect(within(group()).getByText(/100% complete/)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Skip/ })
    ).not.toBeInTheDocument()
  })
})
