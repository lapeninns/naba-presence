import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { SuggestionList } from "@/components/locations/suggestions/suggestion-list"
import { ApiClientError } from "@/lib/api/client"
import * as importReviewApi from "@/lib/api/location-import-review"
import type { ImportProposal } from "@/lib/api/location-import-review"

const LOCATION = "33333333-3333-4333-8333-333333333333"
const REVISION = "rev-7"

function proposal(overrides: Partial<ImportProposal> = {}): ImportProposal {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    resourceType: "profile",
    identityKey: "phone",
    kind: "field_changed",
    fieldKey: "phone",
    googlePath: null,
    sectionLabel: null,
    itemLabel: null,
    matchStatus: null,
    matchConfidence: null,
    canonicalValue: "01234 567890",
    googleValue: "01234 000000",
    suggestedPatch: null,
    warnings: [],
    status: "pending",
    decision: null,
    failureCode: null,
    pinnedCanonicalRevision: REVISION,
    raisedVia: "sweep",
    observedAt: new Date().toISOString(),
    decidedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function decided(p: ImportProposal) {
  return {
    proposal: { ...p, status: "applied" as const, decision: "apply" },
    canonicalRevision: "rev-8",
  }
}

function renderList(
  proposals: ImportProposal[],
  props: Partial<React.ComponentProps<typeof SuggestionList>> = {}
) {
  return renderWithProviders(
    <SuggestionList
      locationId={LOCATION}
      resourceType="profile"
      proposals={proposals}
      canonicalRevision={REVISION}
      editDisabledReason={null}
      editorHref={`/listings/${LOCATION}/profile`}
      {...props}
    />
  )
}

describe("SuggestionList", () => {
  afterEach(() => vi.restoreAllMocks())

  it("shows each suggestion as a row: title, kind word, Here now against On Google, Accept and Ignore", () => {
    renderList([proposal()])

    const group = screen.getByRole("region", { name: /Business profile/ })
    expect(group).toHaveTextContent("1 waiting")
    expect(
      within(group).getByRole("link", { name: "Open business profile" })
    ).toHaveAttribute("href", `/listings/${LOCATION}/profile`)

    const row = within(group).getByRole("listitem")
    expect(row).toHaveTextContent("Phone")
    expect(row).toHaveTextContent("Changed on Google")
    expect(row).toHaveTextContent("Here now")
    expect(row).toHaveTextContent("On Google")
    expect(row).toHaveTextContent("01234 567890")
    expect(row).toHaveTextContent("01234 000000")
    expect(within(row).getByRole("button", { name: "Accept" })).toBeEnabled()
    expect(within(row).getByRole("button", { name: "Ignore" })).toBeEnabled()
    expect(
      within(row).queryByRole("button", { name: "Keep here" })
    ).not.toBeInTheDocument()
  })

  it("accepts with the apply decision, the pinned revision and no overwrite, and says nothing was sent to Google", async () => {
    const user = userEvent.setup()
    const p = proposal()
    const decide = vi
      .spyOn(importReviewApi, "decideImportProposal")
      .mockResolvedValue(decided(p))
    renderList([p])

    await user.click(screen.getByRole("button", { name: "Accept" }))

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1))
    expect(decide.mock.calls[0]?.[0]).toBe(LOCATION)
    expect(decide.mock.calls[0]?.[1]).toBe(p.id)
    expect(decide.mock.calls[0]?.[2]).toMatchObject({
      action: "apply",
      resourceType: "profile",
      expectedCanonicalRevision: REVISION,
      confirmOverwriteCanonicalChanges: false,
    })
    expect(await screen.findByText("Suggestion accepted")).toBeInTheDocument()
  })

  it("ignores without asking for an acknowledgement", async () => {
    const user = userEvent.setup()
    const p = proposal({ warnings: ["canonical_also_changed"] })
    const decide = vi
      .spyOn(importReviewApi, "decideImportProposal")
      .mockResolvedValue(decided(p))
    renderList([p])

    expect(screen.getByText("Also edited here")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Ignore" }))

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1))
    expect(decide.mock.calls[0]?.[2]).toMatchObject({ action: "ignore" })
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(await screen.findByText("Suggestion ignored")).toBeInTheDocument()
  })

  it("asks for the acknowledgement before accepting over a local edit", async () => {
    const user = userEvent.setup()
    const p = proposal({ warnings: ["canonical_also_changed"] })
    const decide = vi
      .spyOn(importReviewApi, "decideImportProposal")
      .mockResolvedValue(decided(p))
    renderList([p])

    await user.click(screen.getByRole("button", { name: "Accept" }))
    const dialog = await screen.findByRole("alertdialog", {
      name: "Overwrite your local change?",
    })
    expect(decide).not.toHaveBeenCalled()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I understand this changes my local data.",
      })
    )
    await user.click(within(dialog).getByRole("button", { name: "Accept" }))

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1))
    expect(decide.mock.calls[0]?.[2]).toMatchObject({
      action: "apply",
      confirmOverwriteCanonicalChanges: true,
    })
  })

  it("offers Keep here and Remove here for an item Google no longer has", () => {
    renderList(
      [
        proposal({
          resourceType: "food_menus",
          kind: "item_missing_from_google",
          fieldKey: null,
          sectionLabel: "Starters",
          itemLabel: "Soup",
        }),
      ],
      { resourceType: "food_menus", editorHref: `/listings/${LOCATION}/menu` }
    )

    const group = screen.getByRole("region", { name: /Food menu/ })
    expect(group).toHaveTextContent("Starters · Soup")
    expect(group).toHaveTextContent("Missing on Google")
    expect(
      within(group).getByRole("button", { name: "Keep here" })
    ).toBeInTheDocument()
    expect(
      within(group).getByRole("button", { name: "Remove here" })
    ).toBeInTheDocument()
    expect(
      within(group).queryByRole("button", { name: "Accept" })
    ).not.toBeInTheDocument()
  })

  it("keeps a failed decision on its row with the reason and a Retry, and does not toast it as well", async () => {
    const user = userEvent.setup()
    vi.spyOn(importReviewApi, "decideImportProposal").mockRejectedValue(
      new ApiClientError(
        409,
        "canonical_resource_stale",
        "The profile changed after it was loaded. Refresh and try again."
      )
    )
    renderList([proposal()])

    await user.click(screen.getByRole("button", { name: "Accept" }))

    const row = screen.getByRole("listitem")
    const failure = await within(row).findByRole("alert")
    expect(failure).toHaveTextContent("Not applied")
    expect(failure).toHaveTextContent(
      "This changed since you loaded it. Refresh and try again."
    )
    expect(
      within(failure).getByRole("button", { name: "Retry" })
    ).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: "Accept" })).toBeEnabled()
    // The claim was released, so the row's alert stays: one announcement.
    expect(
      screen.getAllByText(
        "This changed since you loaded it. Refresh and try again."
      )
    ).toHaveLength(1)
  })

  it("names the suggestion in the toast when the server marks it failed", async () => {
    const user = userEvent.setup()
    vi.spyOn(importReviewApi, "decideImportProposal").mockRejectedValue(
      new ApiClientError(
        409,
        "proposal_target_missing",
        "The menu item no longer exists."
      )
    )
    renderList(
      [
        proposal({
          resourceType: "food_menus",
          kind: "item_changed",
          fieldKey: null,
          sectionLabel: "Starters",
          itemLabel: "Soup",
        }),
      ],
      { resourceType: "food_menus", editorHref: `/listings/${LOCATION}/menu` }
    )

    await user.click(screen.getByRole("button", { name: "Accept" }))

    // The refetch drops a failed row, so the toast must say which one.
    expect(
      await screen.findByText(
        "Starters · Soup: The menu item this suggestion applies to no longer exists here."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText("Check Google now to load the latest suggestions.")
    ).toBeInTheDocument()
  })

  it("holds a decided row's buttons until the refetch takes the row away", async () => {
    const user = userEvent.setup()
    const p = proposal()
    const decide = vi
      .spyOn(importReviewApi, "decideImportProposal")
      .mockResolvedValue(decided(p))
    // The page's query: the list it was given until the refetch answers.
    function Harness() {
      const [proposals, setProposals] = useState([p])
      return (
        <>
          <SuggestionList
            locationId={LOCATION}
            resourceType="profile"
            proposals={proposals}
            canonicalRevision={REVISION}
            editDisabledReason={null}
            editorHref={`/listings/${LOCATION}/profile`}
          />
          <button type="button" onClick={() => setProposals([])}>
            Refetch answers
          </button>
        </>
      )
    }
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(await screen.findByText("Suggestion accepted")).toBeInTheDocument()

    for (const name of ["Accept", "Ignore"]) {
      const button = screen.getByRole("button", { name })
      expect(button).toHaveAttribute("aria-disabled", "true")
      expect(button).toHaveAccessibleDescription(
        "Already decided. The list is updating."
      )
      await user.click(button)
    }
    expect(decide).toHaveBeenCalledTimes(1)

    // The refetch answers without the decided row.
    await user.click(screen.getByRole("button", { name: "Refetch answers" }))
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
  })

  it("explains on every decision button why a viewer cannot decide", async () => {
    const user = userEvent.setup()
    const decide = vi.spyOn(importReviewApi, "decideImportProposal")
    renderList([proposal()], {
      editDisabledReason: "Only owners and admins can edit this location.",
    })

    for (const name of ["Accept", "Ignore"]) {
      const button = screen.getByRole("button", { name })
      expect(button).toHaveAttribute("aria-disabled", "true")
      expect(button).toHaveAccessibleDescription(
        "Only owners and admins can accept or ignore suggestions."
      )
      await user.click(button)
    }
    expect(decide).not.toHaveBeenCalled()
  })

  it("gives the billing reason, not the role one, when the workspace is read-only", () => {
    renderList([proposal()], {
      editDisabledReason:
        "This workspace's subscription is read-only, so changes are unavailable.",
    })

    for (const name of ["Accept", "Ignore"]) {
      const button = screen.getByRole("button", { name })
      expect(button).toHaveAttribute("aria-disabled", "true")
      expect(button).toHaveAccessibleDescription(
        "This workspace's subscription is read-only, so changes are unavailable."
      )
    }
  })

  it("explains Accept and Ignore once for the group, not on every row", () => {
    renderList([
      proposal(),
      proposal({
        id: "22222222-2222-4222-8222-222222222222",
        identityKey: "website",
        fieldKey: "website",
      }),
    ])

    const group = screen.getByRole("region", { name: /Business profile/ })
    expect(group).toHaveAccessibleDescription(
      "Accept takes Google’s value into NabaPresence’s copy. Ignore keeps yours, and the next publish of this area puts yours back on Google over this change."
    )
    expect(screen.getAllByText(/Accept takes Google’s value/)).toHaveLength(1)
  })

  it("says nothing is waiting when the group is empty", () => {
    renderList([])
    expect(
      screen.getByRole("region", { name: /Business profile/ })
    ).toHaveTextContent("0 waiting")
    expect(
      screen.getByText(
        "Nothing waiting here. Changes made on Google appear here for review."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Accept" })
    ).not.toBeInTheDocument()
  })
})
