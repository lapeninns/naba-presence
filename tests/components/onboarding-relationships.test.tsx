import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { OnboardingRelationships } from "@/components/setup/onboarding-relationships"
import type { GoogleRelationship } from "@/lib/domain/google-relationships"

import { Controlled, pick } from "./onboarding-form-helpers"

type State = GoogleRelationship | undefined

function setup(initial: State = undefined) {
  const seen: State[] = []
  const onEntryChange = vi.fn()
  const user = userEvent.setup()
  render(
    <Controlled initial={initial} seen={seen}>
      {(value, set) => (
        <OnboardingRelationships
          value={value}
          onChange={set}
          onEntryChange={onEntryChange}
        />
      )}
    </Controlled>
  )
  return { user, seen, onEntryChange }
}

const parentGroup = () =>
  screen.getByRole("group", { name: "Proposed parent business" })
const childGroup = () =>
  screen.getByRole("group", { name: "Proposed child businesses" })

describe("OnboardingRelationships parent", () => {
  it("starts empty, and Set stays disabled until an ID and a relationship are both given", async () => {
    const { user } = setup()
    expect(
      within(parentGroup()).getByText("No parent business in this proposal.")
    ).toBeInTheDocument()
    const set = within(parentGroup()).getByRole("button", {
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

  it("hands back the parent with the place ID trimmed and the relation chosen", async () => {
    const { user, seen } = setup()
    await user.type(
      screen.getByLabelText("Parent business place ID"),
      "  ChIJabc  "
    )
    await pick(user, "Relationship to parent", "Department")
    await user.click(
      screen.getByRole("button", { name: "Set parent business" })
    )

    expect(seen).toEqual([
      { parentLocation: { placeId: "ChIJabc", relationType: "DEPARTMENT_OF" } },
    ])
    expect(screen.getByText("ChIJabc")).toBeInTheDocument()
    expect(screen.getByLabelText("Parent business place ID")).toHaveValue("")
  })

  it("refuses a Maps URL or a name in place of a place ID", async () => {
    const { user, seen } = setup()
    await user.type(
      screen.getByLabelText("Parent business place ID"),
      "https://maps.google.com/?cid=1"
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
    expect(seen).toEqual([])
  })

  it("clears the error as soon as the ID is edited", async () => {
    const { user } = setup()
    const id = screen.getByLabelText("Parent business place ID")
    await user.type(id, "a b")
    await pick(user, "Relationship to parent", "Department")
    await user.click(
      screen.getByRole("button", { name: "Set parent business" })
    )
    expect(
      await screen.findByText(/without spaces or URL characters/)
    ).toBeInTheDocument()
    await user.type(id, "x")
    expect(
      screen.queryByText(/without spaces or URL characters/)
    ).not.toBeInTheDocument()
  })

  it("removes the parent and keeps the chain affiliation", async () => {
    const { user, seen } = setup({
      parentChain: "chains/abc",
      parentLocation: { placeId: "P1", relationType: "DEPARTMENT_OF" },
    })
    expect(
      screen.getByText(/Proposed chain affiliation: chains\/abc\./)
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Remove parent from proposal P1" })
    )
    expect(seen).toEqual([{ parentChain: "chains/abc" }])
  })
})

describe("OnboardingRelationships children", () => {
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

  it("adds children one after another", async () => {
    const { user, seen } = setup()
    await addChild(user, "C1", "Department")
    await addChild(user, "C2", "Independent business at the same address")
    expect(seen.at(-1)).toEqual({
      childrenLocations: [
        { placeId: "C1", relationType: "DEPARTMENT_OF" },
        { placeId: "C2", relationType: "INDEPENDENT_ESTABLISHMENT_IN" },
      ],
    })
    expect(within(childGroup()).getAllByText(/^C\d$/)).toHaveLength(2)
  })

  it("will not add a child ID twice", async () => {
    const { user, seen } = setup({
      childrenLocations: [{ placeId: "C1", relationType: "DEPARTMENT_OF" }],
    })
    await addChild(user, "C1", "Independent business at the same address")
    expect(
      await screen.findByText(
        "This child place ID is already in the proposal. Remove it before changing its relationship."
      )
    ).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("removes one child, and the last removal hands back undefined", async () => {
    const { user, seen } = setup({
      childrenLocations: [
        { placeId: "C1", relationType: "DEPARTMENT_OF" },
        { placeId: "C2", relationType: "DEPARTMENT_OF" },
      ],
    })
    await user.click(
      screen.getByRole("button", { name: "Remove child from proposal C1" })
    )
    expect(seen.at(-1)).toEqual({
      childrenLocations: [{ placeId: "C2", relationType: "DEPARTMENT_OF" }],
    })
    await user.click(
      screen.getByRole("button", { name: "Remove child from proposal C2" })
    )
    expect(seen.at(-1)).toBeUndefined()
  })

  it("reports a half-filled entry as unsaved, per entry, until it is added or discarded", async () => {
    const { user, onEntryChange } = setup()
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    await user.type(screen.getByLabelText("New child business place ID"), "C1")
    expect(onEntryChange).toHaveBeenLastCalledWith(true)
    expect(
      screen.getByText(
        "Add the child or discard this entry before saving or searching."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Set the parent or discard/)
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Discard child entry" })
    )
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByLabelText("New child business place ID")).toHaveValue("")
  })
})
