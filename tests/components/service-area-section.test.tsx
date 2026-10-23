import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { ServiceAreaSection } from "@/components/locations/profile/sections/service-area-section"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"

import { pick } from "./onboarding-form-helpers"
import { emptyDraft, renderWithDraft } from "./profile-draft-host"

const withArea = (
  serviceArea: BusinessInformationDraft["serviceArea"],
  extra: Partial<BusinessInformationDraft> = {}
): BusinessInformationDraft => ({ ...emptyDraft, serviceArea, ...extra })

function setup(
  draft: BusinessInformationDraft = emptyDraft,
  {
    location = {},
    disabled = false,
    error,
  }: { location?: unknown; disabled?: boolean; error?: string } = {}
) {
  const user = userEvent.setup()
  const host = renderWithDraft(draft, (current, setDraft) => (
    <ServiceAreaSection
      draft={current}
      setDraft={setDraft}
      location={location}
      disabled={disabled}
      changed={false}
      error={error}
    />
  ))
  return { user, ...host }
}

const add = () => screen.getByRole("button", { name: "Add service area" })

describe("ServiceAreaSection business type", () => {
  it("says no service area is configured and offers no country or area fields", () => {
    setup()
    expect(
      screen.getByRole("combobox", { name: "Where do you serve customers?" })
    ).toHaveTextContent("No service area configured")
    expect(
      screen.queryByLabelText("Service-area country code")
    ).not.toBeInTheDocument()
  })

  it("starts a service area from the chosen type, revealing the country and areas", async () => {
    const { user, latest } = setup()
    await pick(
      user,
      "Where do you serve customers?",
      "Business and customer locations"
    )
    expect(latest().serviceArea).toEqual({
      businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
    })
    expect(
      screen.getByLabelText("Service-area country code")
    ).toBeInTheDocument()
    expect(
      screen.getByText("0 of 20 service areas in this draft.")
    ).toBeInTheDocument()
  })

  it("only offers the storefront removal for a customer-only business", async () => {
    const { user, latest } = setup(
      withArea({
        businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
        regionCode: "GB",
      })
    )
    expect(
      screen.queryByRole("checkbox", {
        name: "Remove the storefront address from this profile",
      })
    ).not.toBeInTheDocument()
    await pick(user, "Where do you serve customers?", "Customer locations only")
    const remove = await screen.findByRole("checkbox", {
      name: "Remove the storefront address from this profile",
    })
    await user.click(remove)
    expect(latest().clearStorefrontAddress).toBe(true)
    // Back to a business that keeps its storefront: the removal is dropped.
    await pick(
      user,
      "Where do you serve customers?",
      "Business and customer locations"
    )
    expect(latest().clearStorefrontAddress).toBe(false)
  })

  it("does not ask again to remove the address when it is already customer-only with no storefront", () => {
    setup(
      withArea({ businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB" }),
      {
        location: {
          serviceArea: {
            businessType: "CUSTOMER_LOCATION_ONLY",
            regionCode: "GB",
          },
        },
      }
    )
    expect(
      screen.queryByRole("checkbox", {
        name: "Remove the storefront address from this profile",
      })
    ).not.toBeInTheDocument()
  })

  it("shows the error the page reports for the type", () => {
    setup(emptyDraft, {
      error:
        "A customer-locations-only business requires its service-area country code.",
    })
    expect(
      screen.getByText(
        "A customer-locations-only business requires its service-area country code."
      )
    ).toBeInTheDocument()
  })
})

describe("ServiceAreaSection country", () => {
  it("upper-cases and trims the country code as it is typed, and names the country", async () => {
    const { user, latest } = setup(
      withArea({ businessType: "CUSTOMER_LOCATION_ONLY" })
    )
    await user.type(screen.getByLabelText("Service-area country code"), "gb")
    expect(latest().serviceArea?.regionCode).toBe("GB")
    expect(
      screen.getByText(/^United Kingdom\. Two-letter country code/)
    ).toBeInTheDocument()
  })

  it("will not change a country Google already holds", () => {
    setup(
      withArea({ businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB" }),
      {
        location: {
          serviceArea: {
            businessType: "CUSTOMER_LOCATION_ONLY",
            regionCode: "GB",
          },
        },
      }
    )
    expect(screen.getByLabelText("Service-area country code")).toBeDisabled()
  })
})

describe("ServiceAreaSection areas", () => {
  const base = withArea({
    businessType: "CUSTOMER_LOCATION_ONLY",
    regionCode: "GB",
  })

  async function addArea(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    placeId: string
  ) {
    await user.type(screen.getByLabelText("New area name"), name)
    await user.type(screen.getByLabelText("New area place ID"), placeId)
    await user.click(add())
  }

  it("keeps Add disabled until both fields are filled", async () => {
    const { user } = setup(base)
    expect(add()).toBeDisabled()
    await user.type(screen.getByLabelText("New area name"), "Cambridge")
    expect(add()).toBeDisabled()
    await user.type(screen.getByLabelText("New area place ID"), "ChIJ1")
    expect(add()).toBeEnabled()
  })

  it("adds the area to the draft's service area and clears the entry", async () => {
    const { user, latest } = setup(base)
    await addArea(user, "Cambridge", "ChIJ1")
    expect(latest().serviceArea).toEqual({
      businessType: "CUSTOMER_LOCATION_ONLY",
      regionCode: "GB",
      places: { placeInfos: [{ placeName: "Cambridge", placeId: "ChIJ1" }] },
    })
    expect(
      screen.getByText("1 of 20 service areas in this draft.")
    ).toBeInTheDocument()
    expect(screen.getByLabelText("New area name")).toHaveValue("")
  })

  it("refuses a URL as a place ID, keeps the entry, and drops the message when edited", async () => {
    const { user, latest } = setup(base)
    await addArea(user, "Cambridge", "https://maps.example/x")
    expect(
      await screen.findByText(
        "Enter a place identifier without spaces or URL characters."
      )
    ).toBeInTheDocument()
    expect(latest().serviceArea?.places).toBeUndefined()
    expect(screen.getByLabelText("New area name")).toHaveValue("Cambridge")
    await user.type(screen.getByLabelText("New area place ID"), "!")
    expect(
      screen.queryByText(
        "Enter a place identifier without spaces or URL characters."
      )
    ).not.toBeInTheDocument()
  })

  it("refuses a repeated place ID", async () => {
    const { user, latest } = setup(
      withArea({
        businessType: "CUSTOMER_LOCATION_ONLY",
        regionCode: "GB",
        places: { placeInfos: [{ placeName: "Cambridge", placeId: "P1" }] },
      })
    )
    await addArea(user, "Ely", "P1")
    expect(
      await screen.findByText(
        "Each service area must have a different place ID."
      )
    ).toBeInTheDocument()
    expect(latest().serviceArea?.places?.placeInfos).toHaveLength(1)
  })

  it("removes one area and keeps the rest", async () => {
    const { user, latest } = setup(
      withArea({
        businessType: "CUSTOMER_LOCATION_ONLY",
        regionCode: "GB",
        places: {
          placeInfos: [
            { placeName: "Cambridge", placeId: "P1" },
            { placeName: "Ely", placeId: "P2" },
          ],
        },
      })
    )
    await user.click(
      screen.getByRole("button", { name: "Remove service area Cambridge" })
    )
    expect(latest().serviceArea?.places?.placeInfos).toEqual([
      { placeName: "Ely", placeId: "P2" },
    ])
  })

  it("stops offering new areas at 20", () => {
    setup(
      withArea({
        businessType: "CUSTOMER_LOCATION_ONLY",
        regionCode: "GB",
        places: {
          placeInfos: Array.from({ length: 20 }, (_, index) => ({
            placeName: `Area ${index}`,
            placeId: `P${index}`,
          })),
        },
      })
    )
    expect(
      screen.getByText("20 of 20 service areas in this draft.")
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("New area name")).not.toBeInTheDocument()
  })
})

describe("ServiceAreaSection when it cannot be edited", () => {
  const stored = { businessType: "NOT_A_TYPE" }

  it("hands service-area data it cannot preserve over to Google and locks the fields", () => {
    setup(
      withArea({ businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB" }),
      {
        location: { serviceArea: stored },
      }
    )
    expect(
      screen.getByText(
        /Google returned service-area data this editor cannot preserve/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Manage service areas in Google" })
    ).toHaveAttribute("href", "https://business.google.com/locations")
    expect(
      screen.getByRole("combobox", { name: "Where do you serve customers?" })
    ).toBeDisabled()
    expect(add()).toBeDisabled()
  })

  it("locks every field while the page is read-only", () => {
    setup(
      withArea({ businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB" }),
      {
        disabled: true,
      }
    )
    expect(screen.getByLabelText("Service-area country code")).toBeDisabled()
    expect(screen.getByLabelText("New area name")).toBeDisabled()
    expect(add()).toBeDisabled()
  })
})
