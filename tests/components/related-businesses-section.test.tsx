import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { RelatedBusinessesSection } from "@/components/locations/profile/sections/related-businesses-section"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"

import { pick } from "./onboarding-form-helpers"
import { emptyDraft, renderWithDraft } from "./profile-draft-host"

function setup(
  relationshipData: BusinessInformationDraft["relationshipData"] = undefined,
  {
    location = {},
    disabled = false,
    error,
  }: { location?: unknown; disabled?: boolean; error?: string } = {}
) {
  const user = userEvent.setup()
  const host = renderWithDraft(
    { ...emptyDraft, relationshipData },
    (draft, setDraft) => (
      <RelatedBusinessesSection
        draft={draft}
        setDraft={setDraft}
        location={location}
        disabled={disabled}
        changed={false}
        error={error}
      />
    )
  )
  return { user, ...host }
}

const parent = () => screen.getByRole("group", { name: "Parent business" })
const children = () => screen.getByRole("group", { name: "Child businesses" })

describe("RelatedBusinessesSection parent", () => {
  it("says there is none, and Set stays disabled until an ID and a relationship are given", async () => {
    const { user } = setup()
    expect(
      within(parent()).getByText("No parent business in this draft.")
    ).toBeInTheDocument()
    const set = within(parent()).getByRole("button", {
      name: "Set parent business",
    })
    expect(set).toBeDisabled()
    await user.type(
      screen.getByLabelText("Parent business place ID"),
      "ChIJabc"
    )
    expect(set).toBeDisabled()
    await pick(user, "Relationship to parent", "Department")
    expect(set).toBeEnabled()
  })

  it("sets the parent in the draft and clears the entry", async () => {
    const { user, latest } = setup()
    await user.type(
      screen.getByLabelText("Parent business place ID"),
      "ChIJabc"
    )
    await pick(
      user,
      "Relationship to parent",
      "Independent business at the same address"
    )
    await user.click(
      screen.getByRole("button", { name: "Set parent business" })
    )
    expect(latest().relationshipData).toEqual({
      parentLocation: {
        placeId: "ChIJabc",
        relationType: "INDEPENDENT_ESTABLISHMENT_IN",
      },
    })
    expect(screen.getByText("ChIJabc")).toBeInTheDocument()
    expect(screen.getByLabelText("Parent business place ID")).toHaveValue("")
  })

  it("refuses a Maps URL and says what a place ID looks like, until the entry is edited", async () => {
    const { user, latest } = setup()
    await user.type(
      screen.getByLabelText("Parent business place ID"),
      "https://maps.example/x"
    )
    await pick(user, "Relationship to parent", "Department")
    await user.click(
      screen.getByRole("button", { name: "Set parent business" })
    )
    expect(
      await screen.findByText(
        "Enter a Google place ID without spaces or URL characters and choose a relationship."
      )
    ).toBeInTheDocument()
    expect(latest().relationshipData).toBeUndefined()
    await user.type(screen.getByLabelText("Parent business place ID"), "!")
    expect(
      screen.queryByText(/without spaces or URL characters/)
    ).not.toBeInTheDocument()
  })

  it("removing the parent writes an empty parent, which tells Google to clear it", async () => {
    const { user, latest } = setup({
      parentLocation: { placeId: "P1", relationType: "DEPARTMENT_OF" },
    })
    await user.click(
      screen.getByRole("button", { name: "Remove parent business P1" })
    )
    expect(latest().relationshipData).toEqual({ parentLocation: {} })
    expect(
      within(parent()).getByText("No parent business in this draft.")
    ).toBeInTheDocument()
  })
})

describe("RelatedBusinessesSection children", () => {
  async function addChild(
    user: ReturnType<typeof userEvent.setup>,
    placeId: string,
    relation: string
  ) {
    await user.type(
      screen.getByLabelText("New child business place ID"),
      placeId
    )
    await pick(user, "Relationship of child", relation)
    await user.click(screen.getByRole("button", { name: "Add child business" }))
  }

  it("adds children one after another, keeping the parent", async () => {
    const { user, latest } = setup({
      parentLocation: { placeId: "P1", relationType: "DEPARTMENT_OF" },
    })
    await addChild(user, "C1", "Department")
    await addChild(user, "C2", "Independent business at the same address")
    expect(latest().relationshipData).toEqual({
      parentLocation: { placeId: "P1", relationType: "DEPARTMENT_OF" },
      childrenLocations: [
        { placeId: "C1", relationType: "DEPARTMENT_OF" },
        { placeId: "C2", relationType: "INDEPENDENT_ESTABLISHMENT_IN" },
      ],
    })
  })

  it("will not add a child ID twice", async () => {
    const { user, latest } = setup({
      childrenLocations: [{ placeId: "C1", relationType: "DEPARTMENT_OF" }],
    })
    await addChild(user, "C1", "Independent business at the same address")
    expect(
      await screen.findByText(
        "This child place ID is already in the draft. Remove it before changing its relationship."
      )
    ).toBeInTheDocument()
    expect(latest().relationshipData?.childrenLocations).toHaveLength(1)
  })

  it("removes one child and keeps the others", async () => {
    const { user, latest } = setup({
      childrenLocations: [
        { placeId: "C1", relationType: "DEPARTMENT_OF" },
        { placeId: "C2", relationType: "DEPARTMENT_OF" },
      ],
    })
    await user.click(
      screen.getByRole("button", { name: "Remove child business C1" })
    )
    expect(latest().relationshipData?.childrenLocations).toEqual([
      { placeId: "C2", relationType: "DEPARTMENT_OF" },
    ])
    expect(within(children()).queryByText("C1")).not.toBeInTheDocument()
  })
})

describe("RelatedBusinessesSection when it cannot be edited", () => {
  it("hands a parent Google holds in a shape it cannot preserve over to Google, and locks it", () => {
    setup(undefined, {
      location: {
        relationshipData: {
          parentLocation: { placeId: "x y", relationType: "NOPE" },
        },
      },
    })
    expect(
      screen.getByText(
        /The existing parent business data cannot be edited safely here\./
      )
    ).toBeInTheDocument()
    expect(
      within(parent()).getByRole("button", { name: "Set parent business" })
    ).toBeDisabled()
    // The children are a separate field, still editable.
    expect(
      within(children()).getByRole("button", { name: "Add child business" })
    ).toBeDisabled()
    expect(screen.getByLabelText("New child business place ID")).toBeEnabled()
  })

  it("locks everything while the page is read-only", () => {
    setup(undefined, { disabled: true })
    expect(screen.getByLabelText("Parent business place ID")).toBeDisabled()
    expect(screen.getByLabelText("New child business place ID")).toBeDisabled()
  })

  it("shows the error the page reports for the section", () => {
    setup(undefined, {
      error: "Each related location must have a different place ID.",
    })
    expect(
      screen.getByText("Each related location must have a different place ID.")
    ).toBeInTheDocument()
  })
})
