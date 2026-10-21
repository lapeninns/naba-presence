import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OnboardingMoreHours } from "@/components/setup/onboarding-more-hours"
import type { GoogleOnboardingMoreHours } from "@/lib/domain/google-onboarding-hours"
import { SERVICE_UNAVAILABLE_COPY } from "@/lib/errors/action-errors"

import {
  ACCOUNT,
  DRAFT,
  HASH,
  draftFixture,
  errorResponse,
  jsonResponse,
  stubNetwork,
} from "./onboarding-draft-fixtures"
import { Controlled, pick } from "./onboarding-form-helpers"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const withCategory = draftFixture({
  payload: { categories: { primaryCategory: { name: "categories/gcid:pub" } } },
})

const services = (overrides: Record<string, unknown> = {}) =>
  jsonResponse({
    draftId: DRAFT,
    revision: withCategory.revision,
    payloadHash: HASH,
    regionCode: "GB",
    languageCode: "en-GB",
    observedAt: "2026-10-14T10:06:00.000Z",
    categories: [
      {
        name: "categories/gcid:pub",
        moreHoursTypes: [
          { hoursTypeId: "KITCHEN", localizedDisplayName: "Kitchen" },
          { hoursTypeId: "BRUNCH", displayName: "Brunch" },
        ],
      },
    ],
    ...overrides,
  })

function setup({
  initial,
  draft = withCategory,
  contextSaved = true,
}: {
  initial?: GoogleOnboardingMoreHours
  draft?: ReturnType<typeof draftFixture>
  contextSaved?: boolean
} = {}) {
  const seen: Array<GoogleOnboardingMoreHours | undefined> = []
  const onEntryChange = vi.fn()
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Controlled initial={initial} seen={seen}>
        {(value, set) => (
          <OnboardingMoreHours
            draft={draft}
            value={value}
            contextSaved={contextSaved}
            onChange={set}
            onEntryChange={onEntryChange}
          />
        )}
      </Controlled>
    </QueryClientProvider>
  )
  return { user, seen, onEntryChange }
}

const ready = () =>
  waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Additional hours type" })
    ).toBeEnabled()
  )
const add = () =>
  screen.getByRole("button", { name: "Add service hours period" })

async function fill(user: ReturnType<typeof userEvent.setup>, type: string) {
  await pick(user, "Additional hours type", type)
  await pick(user, "Additional opening day", "Monday")
  await user.type(screen.getByLabelText("Additional opening time"), "1200")
  await pick(user, "Additional closing day", "Monday")
  await user.type(screen.getByLabelText("Additional closing time"), "1500")
}

describe("OnboardingMoreHours", () => {
  it("asks for the saved categories first and makes no request until they are saved", async () => {
    const { fetchMock } = stubNetwork(() => services())
    setup({ contextSaved: false })
    expect(
      screen.getByText(
        "Select and save the categories, language and country before loading hour types."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Additional hours type" })
    ).toBeDisabled()
    expect(add()).toBeDisabled()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("asks for the saved revision of this draft, then offers only the hour types Google returned", async () => {
    const { calls } = stubNetwork(() => services())
    const { user } = setup()
    expect(
      await screen.findByText("Loading supported hour types…")
    ).toBeInTheDocument()
    await ready()
    expect(calls).toEqual([
      {
        method: "GET",
        path: `/api/google/accounts/${ACCOUNT}/drafts/${DRAFT}/services`,
        query: { expectedRevision: "3" },
        body: undefined,
      },
    ])
    await user.click(
      screen.getByRole("combobox", { name: "Additional hours type" })
    )
    expect(
      await screen.findByRole("option", { name: "Kitchen" })
    ).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Brunch" })).toBeInTheDocument()
  })

  it("hands back a period under the chosen type and clears the entry", async () => {
    stubNetwork(() => services())
    const { user, seen } = setup()
    await ready()
    await fill(user, "Kitchen")
    await user.click(add())

    expect(seen).toEqual([
      [
        {
          hoursTypeId: "KITCHEN",
          periods: [
            {
              openDay: "MONDAY",
              openTime: { hours: 12, minutes: 0 },
              closeDay: "MONDAY",
              closeTime: { hours: 15, minutes: 0 },
            },
          ],
        },
      ],
    ])
    expect(screen.getByText("Monday 12:00 to Monday 15:00")).toBeInTheDocument()
    expect(screen.getByLabelText("Additional opening time")).toHaveValue("")
  })

  it("adds a second period to an existing type, keeping one schedule per type", async () => {
    stubNetwork(() => services())
    const monday = {
      openDay: "MONDAY",
      openTime: { hours: 12, minutes: 0 },
      closeDay: "MONDAY",
      closeTime: { hours: 15, minutes: 0 },
    } as const
    const { user, seen } = setup({
      initial: [{ hoursTypeId: "KITCHEN", periods: [monday] }],
    })
    await ready()
    await pick(user, "Additional hours type", "Kitchen")
    await pick(user, "Additional opening day", "Tuesday")
    await user.type(screen.getByLabelText("Additional opening time"), "1200")
    await pick(user, "Additional closing day", "Tuesday")
    await user.type(screen.getByLabelText("Additional closing time"), "1500")
    await user.click(add())
    expect(seen.at(-1)).toEqual([
      {
        hoursTypeId: "KITCHEN",
        periods: [
          monday,
          {
            openDay: "TUESDAY",
            openTime: { hours: 12, minutes: 0 },
            closeDay: "TUESDAY",
            closeTime: { hours: 15, minutes: 0 },
          },
        ],
      },
    ])
  })

  it("refuses an overlapping period for the same type and keeps the entry", async () => {
    stubNetwork(() => services())
    const { user, seen } = setup({
      initial: [
        {
          hoursTypeId: "KITCHEN",
          periods: [
            {
              openDay: "MONDAY",
              openTime: { hours: 12, minutes: 0 },
              closeDay: "MONDAY",
              closeTime: { hours: 15, minutes: 0 },
            },
          ],
        },
      ],
    })
    await ready()
    await fill(user, "Kitchen")
    await user.click(add())
    expect(
      await screen.findByText("Opening periods cannot overlap or repeat.")
    ).toBeInTheDocument()
    expect(seen).toEqual([])
    expect(screen.getByLabelText("Additional opening time")).toHaveValue(
      "12:00"
    )
  })

  it("removes one period, and the last removal hands back undefined", async () => {
    stubNetwork(() => services())
    const period = {
      openDay: "MONDAY",
      openTime: { hours: 12, minutes: 0 },
      closeDay: "MONDAY",
      closeTime: { hours: 15, minutes: 0 },
    } as const
    const { user, seen } = setup({
      initial: [{ hoursTypeId: "KITCHEN", periods: [period] }],
    })
    await ready()
    await user.click(
      screen.getByRole("button", { name: "Remove KITCHEN period 1" })
    )
    expect(seen.at(-1)).toBeUndefined()
  })

  it("retains a saved type Google no longer lists and says it needs confirming", async () => {
    stubNetwork(() => services())
    setup({
      initial: [
        {
          hoursTypeId: "DRIVE_THROUGH",
          periods: [
            {
              openDay: "MONDAY",
              openTime: { hours: 9, minutes: 0 },
              closeDay: "MONDAY",
              closeTime: { hours: 10, minutes: 0 },
            },
          ],
        },
      ],
    })
    await ready()
    expect(
      screen.getByText(
        "This saved type is retained. Its current support must be confirmed before creation."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Remove DRIVE_THROUGH period 1" })
    ).toBeInTheDocument()
  })

  it("ignores hour types fetched for another revision of the draft", async () => {
    stubNetwork(() => services({ revision: 2 }))
    setup()
    await waitFor(() =>
      expect(
        screen.queryByText("Loading supported hour types…")
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("combobox", { name: "Additional hours type" })
    ).toBeDisabled()
    expect(add()).toBeDisabled()
  })

  it("says so when Google returns no additional hour types", async () => {
    stubNetwork(() =>
      services({ categories: [{ name: "categories/gcid:pub" }] })
    )
    setup()
    expect(
      await screen.findByText(
        "Google returned no additional hour types for these saved categories."
      )
    ).toBeInTheDocument()
  })

  it("shows the failure and offers a retry that asks again", async () => {
    let attempts = 0
    const { calls } = stubNetwork(() =>
      ++attempts === 1 ? errorResponse(503, "google_unavailable") : services()
    )
    const { user } = setup()
    expect(
      await screen.findByText(SERVICE_UNAVAILABLE_COPY)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Additional hours type" })
    ).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Retry hour types" }))
    await ready()
    expect(calls).toHaveLength(2)
    expect(screen.queryByText(SERVICE_UNAVAILABLE_COPY)).not.toBeInTheDocument()
  })

  it("reports a half-filled entry as unsaved until it is discarded", async () => {
    stubNetwork(() => services())
    const { user, onEntryChange } = setup()
    await ready()
    await pick(user, "Additional hours type", "Brunch")
    expect(onEntryChange).toHaveBeenLastCalledWith(true)
    await user.click(
      screen.getByRole("button", { name: "Discard service hours entry" })
    )
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    expect(
      screen.getByRole("combobox", { name: "Additional hours type" })
    ).toHaveTextContent("Choose a supported hour type")
  })
})
