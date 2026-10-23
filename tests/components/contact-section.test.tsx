import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AddressSection,
  ContactSection,
  DescriptionSection,
  OpeningSection,
} from "@/components/locations/profile/sections/contact-section"
import type { ProfileFormValues } from "@/lib/locations/forms/profile"

import { emptyDraft, renderWithDraft } from "./profile-draft-host"

afterEach(() => vi.unstubAllGlobals())

const values: ProfileFormValues = {
  name: "The Old Crown",
  description: "",
  phone: "",
  website: "",
}

/** The page's values state, passed to a section as `values` and `setValues`. */
function renderWithValues(
  initial: ProfileFormValues,
  section: (
    values: ProfileFormValues,
    setValues: React.Dispatch<React.SetStateAction<ProfileFormValues>>
  ) => React.ReactElement
) {
  let latest = initial
  function Host() {
    const [current, setValues] = useState(initial)
    latest = current
    return section(current, setValues)
  }
  render(<Host />)
  return { latest: () => latest, user: userEvent.setup() }
}

describe("ContactSection", () => {
  function setup(
    errors: Partial<Record<keyof ProfileFormValues, string>> = {},
    disabled = false,
    changed = { phone: false, website: false }
  ) {
    return renderWithValues(values, (current, setValues) => (
      <ContactSection
        values={current}
        setValues={setValues}
        errors={errors}
        disabled={disabled}
        changed={changed}
      />
    ))
  }

  it("takes the phone and website into the page's values as they are typed", async () => {
    const { user, latest } = setup()
    await user.type(screen.getByLabelText("Phone"), "+44 20 7946 0000")
    await user.type(screen.getByLabelText("Website"), "https://oldcrown.test")
    expect(latest()).toEqual({
      ...values,
      phone: "+44 20 7946 0000",
      website: "https://oldcrown.test",
    })
  })

  it("asks for the right keyboard and autofill on a phone", () => {
    setup()
    expect(screen.getByLabelText("Phone")).toHaveAttribute("type", "tel")
    expect(screen.getByLabelText("Phone")).toHaveAttribute(
      "autocomplete",
      "tel"
    )
    expect(screen.getByLabelText("Website")).toHaveAttribute("type", "url")
    expect(screen.getByLabelText("Website")).toHaveAttribute("inputmode", "url")
  })

  it("shows each field's error against that field", () => {
    setup({
      phone: "Enter a phone number.",
      website: "Enter a full web address.",
    })
    expect(screen.getByLabelText("Phone")).toHaveAccessibleDescription(
      expect.stringContaining("Enter a phone number.")
    )
    expect(screen.getByLabelText("Website")).toHaveAccessibleDescription(
      expect.stringContaining("Enter a full web address.")
    )
  })

  it("marks only the field that changed, and is read-only when disabled", () => {
    setup({}, true, { phone: true, website: false })
    expect(screen.getAllByText("Changed").length).toBeGreaterThan(0)
    expect(screen.getByLabelText("Phone")).toBeDisabled()
    expect(screen.getByLabelText("Website")).toBeDisabled()
  })
})

describe("DescriptionSection", () => {
  function setup(description: string, error?: string) {
    return renderWithValues(
      { ...values, description },
      (current, setValues) => (
        <DescriptionSection
          values={current}
          setValues={setValues}
          errors={{ description: error }}
          disabled={false}
          changed={false}
        />
      )
    )
  }

  it("counts the characters against the 750 limit as they are typed", async () => {
    const { user, latest } = setup("")
    expect(screen.getByText("0 / 750")).toBeInTheDocument()
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "A calm pub."
    )
    expect(latest().description).toBe("A calm pub.")
    expect(screen.getByText("11 / 750")).toBeInTheDocument()
  })

  it("shows an over-long description in the danger ink and the error the page reports", () => {
    setup("x".repeat(751), "Keep the description to 750 characters.")
    expect(screen.getByText("751 / 750")).toHaveClass("text-danger-ink")
    expect(
      screen.getByRole("textbox", { name: "Description" })
    ).toHaveAccessibleDescription(
      expect.stringContaining("Keep the description to 750 characters.")
    )
  })
})

describe("AddressSection", () => {
  const changedNone = { lines: false, locality: false, postalCode: false }

  function setup(draft = emptyDraft, issues = {}, disabled = false) {
    const user = userEvent.setup()
    const host = renderWithDraft(draft, (current, setDraft) => (
      <AddressSection
        draft={current}
        setDraft={setDraft}
        issues={issues}
        disabled={disabled}
        changed={changedNone}
      />
    ))
    return { user, ...host }
  }

  it("keeps one clean address line per typed line, without eating a trailing space", async () => {
    const { user, latest } = setup()
    const lines = screen.getByLabelText("Address lines")
    await user.type(lines, "1 High Street {Enter}  {Enter}Cambridge")
    expect(latest().addressLines).toEqual(["1 High Street", "Cambridge"])
    // What was typed stays as typed, blank line and all.
    expect(lines).toHaveValue("1 High Street \n  \nCambridge")
  })

  it("puts town, postcode, district and county into the draft", async () => {
    const { user, latest } = setup()
    await user.type(screen.getByLabelText("Town or city"), "Cambridge")
    await user.type(screen.getByLabelText("Postcode"), "CB1 1AA")
    await user.type(
      screen.getByLabelText("District or neighbourhood (optional)"),
      "Mill Road"
    )
    await user.type(
      screen.getByLabelText("County or region (optional)"),
      "Cambridgeshire"
    )
    expect(latest()).toMatchObject({
      locality: "Cambridge",
      postalCode: "CB1 1AA",
      sublocality: "Mill Road",
      administrativeArea: "Cambridgeshire",
    })
  })

  it("shows the draft's saved address, and the errors the page reports against their fields", () => {
    setup(
      {
        ...emptyDraft,
        addressLines: ["1 High Street", "Cambridge"],
        locality: "Cambridge",
      },
      {
        addressLines: "Enter at least one address line.",
        sublocality: "Use fewer than 100 characters.",
      }
    )
    expect(screen.getByLabelText("Address lines")).toHaveValue(
      "1 High Street\nCambridge"
    )
    expect(screen.getByLabelText("Town or city")).toHaveValue("Cambridge")
    expect(screen.getByLabelText("Address lines")).toHaveAccessibleDescription(
      expect.stringContaining("Enter at least one address line.")
    )
    expect(
      screen.getByLabelText("District or neighbourhood (optional)")
    ).toHaveAccessibleDescription(
      expect.stringContaining("Use fewer than 100 characters.")
    )
  })

  it("keeps the extra address details behind a disclosure and offers a sorting code only where it applies", async () => {
    const { user, latest } = setup()
    const details = document.getElementById(
      "profile-address-details"
    ) as HTMLDetailsElement
    expect(details.open).toBe(false)
    await user.click(screen.getByText("Additional address details"))
    expect(details.open).toBe(true)
    await user.type(
      screen.getByLabelText("Address organisation (optional)"),
      "Crown Holdings"
    )
    expect(latest().addressOrganization).toBe("Crown Holdings")
    expect(
      screen.queryByLabelText("Postal sorting code (optional)")
    ).not.toBeInTheDocument()
  })

  it("offers the sorting code for a country that uses one", () => {
    setup({ ...emptyDraft, regionCode: "FR" })
    expect(
      screen.getByLabelText("Postal sorting code (optional)")
    ).toBeInTheDocument()
  })

  it("is read-only when disabled", () => {
    setup(emptyDraft, {}, true)
    expect(screen.getByLabelText("Address lines")).toBeDisabled()
    expect(screen.getByLabelText("Postcode")).toBeDisabled()
  })
})

describe("OpeningSection", () => {
  function setup(draft = emptyDraft, { issues = {}, disabled = false } = {}) {
    const user = userEvent.setup()
    const host = renderWithDraft(draft, (current, setDraft) => (
      <OpeningSection
        locationId="loc-1"
        draft={current}
        setDraft={setDraft}
        issues={issues}
        disabled={disabled}
        changed={false}
        statusChanged={false}
      />
    ))
    return { user, ...host }
  }

  async function choose(
    user: ReturnType<typeof userEvent.setup>,
    option: string
  ) {
    await user.click(screen.getByRole("combobox", { name: "Open status" }))
    await user.click(await screen.findByRole("option", { name: option }))
  }

  it("links to the opening hours, where day-to-day times live", () => {
    setup()
    expect(screen.getByRole("link", { name: "Opening hours" })).toHaveAttribute(
      "href",
      "/listings/loc-1/hours"
    )
  })

  it("sets a temporary closure straight away", async () => {
    const { user, latest } = setup()
    expect(
      screen.getByRole("combobox", { name: "Open status" })
    ).toHaveTextContent("Open")
    await choose(user, "Temporarily closed")
    expect(latest().openStatus).toBe("CLOSED_TEMPORARILY")
  })

  it("asks to confirm a permanent closure, and will not apply it until the person says the business has closed", async () => {
    const { user, latest } = setup()
    await choose(user, "Permanently closed")
    const dialog = await screen.findByRole("alertdialog", {
      name: "Mark as permanently closed?",
    })
    expect(latest().openStatus).toBe("OPEN")
    const confirm = within(dialog).getByRole("button", {
      name: "Mark as permanently closed",
    })
    expect(confirm).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /closed for good/,
      })
    )
    await user.click(confirm)
    expect(latest().openStatus).toBe("CLOSED_PERMANENTLY")
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
  })

  it("keeps the current status when the confirmation is declined", async () => {
    const { user, latest } = setup()
    await choose(user, "Permanently closed")
    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Keep current status" })
    )
    expect(latest().openStatus).toBe("OPEN")
  })

  it("asks again, with the box clear, the next time it is opened", async () => {
    const { user } = setup()
    await choose(user, "Permanently closed")
    let dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("checkbox"))
    await user.click(
      within(dialog).getByRole("button", { name: "Keep current status" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    await choose(user, "Permanently closed")
    dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked()
  })

  it("takes the opening date by part and clears it", async () => {
    const { user, latest } = setup({
      ...emptyDraft,
      openingDate: { year: "", month: "", day: "" },
    })
    await user.type(screen.getByLabelText("Month"), "3")
    await user.type(screen.getByLabelText("Year"), "2020")
    expect(latest().openingDate).toEqual({ year: "2020", month: "3", day: "" })
    await user.click(screen.getByRole("button", { name: "Clear opening date" }))
    expect(latest().openingDate).toBeNull()
  })

  it("is read-only when disabled", () => {
    setup(emptyDraft, { disabled: true })
    expect(screen.getByRole("combobox", { name: "Open status" })).toBeDisabled()
  })

  describe("on a phone", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }))
    })

    it("picks the status from a sheet instead of a select", async () => {
      const { user, latest } = setup()
      expect(
        screen.queryByRole("combobox", { name: "Open status" })
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: /Open status/ }))
      await user.click(
        await screen.findByRole("option", { name: "Temporarily closed" })
      )
      expect(latest().openStatus).toBe("CLOSED_TEMPORARILY")
    })

    it("still asks to confirm a permanent closure, once the sheet has closed", async () => {
      const { user, latest } = setup()
      await user.click(screen.getByRole("button", { name: /Open status/ }))
      await user.click(
        await screen.findByRole("option", { name: "Permanently closed" })
      )
      expect(
        await screen.findByRole("alertdialog", {
          name: "Mark as permanently closed?",
        })
      ).toBeInTheDocument()
      expect(latest().openStatus).toBe("OPEN")
    })
  })
})
