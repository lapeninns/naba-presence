import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  CompletenessInput,
  ListingCompleteness,
} from "@/lib/listings/completeness"

const push = vi.fn()
const replace = vi.fn()
let search = ""
let boardCompleteness: ListingCompleteness[] = []
vi.mock("next/navigation", () => ({
  usePathname: () => "/listings",
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock("@/lib/navigation/shallow-url", () => ({
  replaceUrl: (href: string) => replace(href),
  pushUrl: (href: string) => push(href),
}))
vi.mock("@/lib/listings/completeness-query", () => ({
  useBoardCompleteness: () => ({ data: boardCompleteness, isPending: false }),
}))
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
vi.mock("@/components/listings/file-under-client", () => ({
  FileUnderClient: ({ locationName }: { locationName: string }) => (
    <button type="button">File {locationName} under…</button>
  ),
}))

import { ListingsBoard } from "@/components/listings/listings-board"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import { listingCompleteness } from "@/lib/listings/completeness"
import * as clientsHook from "@/lib/queries/use-clients"
import * as summaryHook from "@/lib/queries/use-listing-summary"
import * as locationsHook from "@/lib/queries/use-locations"

const NOW = new Date("2026-11-15T12:00:00Z")
/** Five days before NOW. */
const FRESH = "2026-11-10T09:00:00Z"
const DESCRIPTION =
  "The Bell at Langham is a family-run village pub on the edge of the Norfolk coast, serving seasonal British cooking, local ales and a proper Sunday roast. Dogs are welcome in the bar, the walled garden catches the afternoon sun, and open fires make winter evenings cosy. Book ahead for weekend lunches and summer evenings."

type ProfileValue = NonNullable<CompletenessInput["profile"]>["value"]

/** Every check passing, unless overridden. */
function fullInput(
  locationId: string,
  overrides: Partial<CompletenessInput> = {},
  profile: Partial<ProfileValue> = {}
): CompletenessInput {
  return {
    locationId,
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

/** Old Crown: two essentials, an important and a nice check fail (9 points). */
const CROWN = listingCompleteness(
  fullInput(
    "l1",
    { verified: false, posts: { lastPublishedAt: null, observedAt: FRESH } },
    { phone: null, additionalCategories: 0 }
  ),
  [],
  NOW
)
/** Harbour View: one nice-to-have fails (1 point). */
const HARBOUR = listingCompleteness(
  fullInput("l2", {}, { additionalCategories: 0 }),
  [],
  NOW
)
/** Pier Cafe: one essential fails (3 points). */
const PIER = listingCompleteness(
  fullInput("l3", {}, { website: null }),
  [],
  NOW
)
/** Nothing read from Google recently enough to score. */
const UNSCORED = listingCompleteness(
  {
    ...fullInput("l2"),
    verified: null,
    profile: null,
    hours: null,
    details: null,
    menu: null,
    posts: { lastPublishedAt: null, observedAt: null },
    photos: { newestAt: null, cover: false, logo: false, observedAt: null },
    booking: { booking: 0, other: 0, observedAt: null },
    reviews: {
      checkedAt: null,
      overdueUnreplied: 0,
      recent: { count: 0, average: null },
      previous: { count: 0, average: null },
    },
  },
  [],
  NOW
)

function summary(locationId: string): ListingSummary {
  return {
    ...emptyListingSummary({ locationId, linked: true, verified: true }),
    connection: {
      status: "active",
      reconnectRequired: false,
      googleEmail: "a@b.c",
    },
    profile: { status: "in_sync", dirtyCount: 0, observedAt: null },
    hours: { status: "in_sync", dirtyCount: 0, observedAt: null },
    menu: {
      status: "in_sync",
      dirtyCount: 0,
      observedAt: null,
      eligible: true,
    },
  }
}

const entries: locationsHook.DirectoryEntry[] = [
  {
    id: "l1",
    name: "Old Crown Girton",
    linked: true,
    verified: true,
    clientId: "c1",
    clientName: "Old Crown Group",
  },
  {
    id: "l2",
    name: "Harbour View",
    linked: true,
    verified: true,
    clientId: "c2",
    clientName: "Harbour Kitchen",
  },
  {
    id: "l3",
    name: "Pier Cafe",
    linked: true,
    verified: false,
    clientId: null,
    clientName: null,
  },
]

function stub(completeness: ListingCompleteness[]) {
  boardCompleteness = completeness
  vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
    data: entries,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: {
      items: [
        { id: "c1", name: "Old Crown Group" },
        { id: "c2", name: "Harbour Kitchen" },
      ],
      unassignedLocationCount: 1,
    },
    isPending: false,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
  vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
    data: entries.map((entry) => summary(entry.id)),
    isPending: false,
  } as unknown as UseQueryResult<ListingSummary[]>)
}

/** The listing names, top to bottom, skipping any group rows. */
function names() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .filter((row) => !row.hasAttribute("data-group"))
    .map((row) => within(row).getAllByRole("link")[0]!.textContent)
}

afterEach(() => {
  vi.restoreAllMocks()
  replace.mockClear()
  push.mockClear()
  search = ""
  boardCompleteness = []
  window.history.replaceState(null, "", "/")
})

describe("ListingsBoard completeness", () => {
  it("shows each listing's score and its first thing to fix", () => {
    stub([CROWN, HARBOUR, PIER])
    render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("columnheader", { name: "Completeness" })
    ).toBeInTheDocument()
    const crown = screen.getByRole("row", { name: /Old Crown Girton/ })
    expect(
      within(crown).getAllByText(`${CROWN.score}%`).length
    ).toBeGreaterThan(0)
    expect(within(crown).getByText(/^Phone number/)).toBeInTheDocument()
    const harbour = screen.getByRole("row", { name: /Harbour View/ })
    expect(
      within(harbour).getByText("Additional categories")
    ).toBeInTheDocument()
  })

  it("orders the most to fix first from the order menu and writes it to the URL", async () => {
    stub([CROWN, HARBOUR, PIER])
    const user = userEvent.setup()
    render(<ListingsBoard role="owner" />)
    // Worst health first: Pier Cafe is unverified, the others are fine.
    expect(names()).toEqual(["Pier Cafe", "Harbour View", "Old Crown Girton"])

    await user.click(screen.getByRole("button", { name: /^Order listings:/ }))
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Most to fix" })
    )
    expect(replace).toHaveBeenLastCalledWith("/listings?order=fix")
    expect(names()).toEqual(["Old Crown Girton", "Pier Cafe", "Harbour View"])
    expect(
      screen.getByRole("button", { name: "Order listings: Most to fix" })
    ).toBeInTheDocument()
  })

  it("reads the most-to-fix order back from the URL", () => {
    search = "order=fix"
    window.history.replaceState(null, "", `/listings?${search}`)
    stub([CROWN, HARBOUR, PIER])
    render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("button", { name: "Order listings: Most to fix" })
    ).toBeInTheDocument()
    expect(names()).toEqual(["Old Crown Girton", "Pier Cafe", "Harbour View"])
  })

  it("says a listing without a score has no score yet", () => {
    expect(UNSCORED.score).toBeNull()
    stub([CROWN, UNSCORED, PIER])
    render(<ListingsBoard role="owner" />)
    const harbour = screen.getByRole("row", { name: /Harbour View/ })
    expect(
      within(harbour).getAllByText(/^no score yet$/i).length
    ).toBeGreaterThan(0)
  })
})
