import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { OnboardingServiceArea } from "@/components/setup/onboarding-service-area"
import type { GoogleServiceArea } from "@/lib/domain/google-service-area"

import { Controlled, pick } from "./onboarding-form-helpers"

type State = GoogleServiceArea | undefined

function setup(initial: State = undefined) {
  const seen: State[] = []
  const onEntryChange = vi.fn()
  const user = userEvent.setup()
  render(
    <Controlled initial={initial} seen={seen}>
      {(value, set) => (
        <OnboardingServiceArea
          value={value}
          onChange={set}
          onEntryChange={onEntryChange}
        />
      )}
    </Controlled>
  )
  return { user, seen, onEntryChange }
}

const kind = () =>
  screen.getByRole("combobox", { name: "Where do you meet customers?" })
const add = () => screen.getByRole("button", { name: "Add service area" })

async function addArea(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  placeId: string
) {
  await user.type(screen.getByLabelText("Service area name"), name)
  await user.type(screen.getByLabelText("Service area place ID"), placeId)
  await user.click(add())
}

describe("OnboardingServiceArea business type", () => {
  it("is a storefront business with no service-area fields by default", () => {
    setup()
    expect(kind()).toHaveTextContent("At the business location only")
    expect(screen.queryByLabelText("Service area name")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Service-area country code" })
    ).not.toBeInTheDocument()
  })

  it("hands back the chosen business type and reveals the country and area fields", async () => {
    const { user, seen } = setup()
    await pick(
      user,
      "Where do you meet customers?",
      "At customer locations only"
    )
    expect(seen).toEqual([{ businessType: "CUSTOMER_LOCATION_ONLY" }])
    expect(
      screen.getByRole("combobox", { name: "Service-area country code" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("0 of 20 service areas in this draft.")
    ).toBeInTheDocument()
  })

  it("keeps the country and areas when the type changes between the two customer options", async () => {
    const { user, seen } = setup({
      businessType: "CUSTOMER_LOCATION_ONLY",
      regionCode: "GB",
      places: { placeInfos: [{ placeName: "Cambridge", placeId: "P1" }] },
    })
    await pick(
      user,
      "Where do you meet customers?",
      "At business and customer locations"
    )
    expect(seen).toEqual([
      {
        businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
        regionCode: "GB",
        places: { placeInfos: [{ placeName: "Cambridge", placeId: "P1" }] },
      },
    ])
  })

  it("drops the whole service area, and any half-typed area, when back at storefront", async () => {
    const { user, seen, onEntryChange } = setup({
      businessType: "CUSTOMER_LOCATION_ONLY",
      regionCode: "GB",
    })
    await user.type(screen.getByLabelText("Service area name"), "Cam")
    expect(onEntryChange).toHaveBeenLastCalledWith(true)
    await pick(
      user,
      "Where do you meet customers?",
      "At the business location only"
    )
    expect(seen.at(-1)).toBeUndefined()
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByLabelText("Service area name")).not.toBeInTheDocument()
  })
})

describe("OnboardingServiceArea country", () => {
  it("stores the bare country code picked by name", async () => {
    const { user, seen } = setup({ businessType: "CUSTOMER_LOCATION_ONLY" })
    const country = screen.getByRole("combobox", {
      name: "Service-area country code",
    })
    await user.type(country, "Germ")
    await user.click(
      await screen.findByRole("option", { name: "Germany · DE" })
    )
    expect(seen.at(-1)).toEqual({
      businessType: "CUSTOMER_LOCATION_ONLY",
      regionCode: "DE",
    })
  })

  it("shows a saved country by name", () => {
    setup({ businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB" })
    expect(
      screen.getByRole("combobox", { name: "Service-area country code" })
    ).toHaveValue("United Kingdom · GB")
  })
})

describe("OnboardingServiceArea areas", () => {
  const base: GoogleServiceArea = {
    businessType: "CUSTOMER_LOCATION_ONLY",
    regionCode: "GB",
  }

  it("keeps Add disabled until both name and place ID are given", async () => {
    const { user } = setup(base)
    expect(add()).toBeDisabled()
    await user.type(screen.getByLabelText("Service area name"), "Cambridge")
    expect(add()).toBeDisabled()
    await user.type(screen.getByLabelText("Service area place ID"), "ChIJ123")
    expect(add()).toBeEnabled()
  })

  it("adds an area with its place ID and clears the entry", async () => {
    const { user, seen } = setup(base)
    await addArea(user, "Cambridge", "ChIJ123")
    expect(seen).toEqual([
      {
        ...base,
        places: {
          placeInfos: [{ placeName: "Cambridge", placeId: "ChIJ123" }],
        },
      },
    ])
    expect(screen.getByText("Cambridge")).toBeInTheDocument()
    expect(screen.getByText("ChIJ123")).toBeInTheDocument()
    expect(
      screen.getByText("1 of 20 service areas in this draft.")
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Service area name")).toHaveValue("")
  })

  it("refuses a Maps URL as a place ID, keeps the entry, and clears the error on edit", async () => {
    const { user, seen } = setup(base)
    await addArea(user, "Cambridge", "https://maps.example/x")
    expect(
      await screen.findByText(
        "Enter a place identifier without spaces or URL characters."
      )
    ).toBeInTheDocument()
    expect(seen).toEqual([])
    expect(screen.getByLabelText("Service area name")).toHaveValue("Cambridge")
    await user.type(screen.getByLabelText("Service area place ID"), "x")
    expect(
      screen.queryByText(
        "Enter a place identifier without spaces or URL characters."
      )
    ).not.toBeInTheDocument()
  })

  it("refuses a place ID that is already in the draft", async () => {
    const { user, seen } = setup({
      ...base,
      places: { placeInfos: [{ placeName: "Cambridge", placeId: "ChIJ123" }] },
    })
    await addArea(user, "Ely", "ChIJ123")
    expect(
      await screen.findByText(
        "Each service area must have a different place ID."
      )
    ).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("removes one area and keeps the others", async () => {
    const { user, seen } = setup({
      ...base,
      places: {
        placeInfos: [
          { placeName: "Cambridge", placeId: "P1" },
          { placeName: "Ely", placeId: "P2" },
        ],
      },
    })
    await user.click(
      screen.getByRole("button", { name: "Remove service area Cambridge" })
    )
    expect(seen.at(-1)).toEqual({
      ...base,
      places: { placeInfos: [{ placeName: "Ely", placeId: "P2" }] },
    })
  })

  it("stops offering new areas at the limit of 20", () => {
    setup({
      ...base,
      places: {
        placeInfos: Array.from({ length: 20 }, (_, index) => ({
          placeName: `Area ${index}`,
          placeId: `P${index}`,
        })),
      },
    })
    expect(
      screen.getByText("20 of 20 service areas in this draft.")
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Service area name")).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: /^Remove service area/ })
    ).toHaveLength(20)
  })

  it("reports a half-typed area as unsaved until it is added or discarded", async () => {
    const { user, onEntryChange } = setup(base)
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    await user.type(screen.getByLabelText("Service area place ID"), "P1")
    expect(onEntryChange).toHaveBeenLastCalledWith(true)
    expect(
      screen.getByText(
        "Add this area or discard its entry before saving or searching."
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Discard area entry" }))
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    const list = screen.getByRole("list")
    expect(within(list).queryAllByRole("listitem")).toHaveLength(0)
  })
})
