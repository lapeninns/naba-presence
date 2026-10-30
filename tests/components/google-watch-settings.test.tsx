import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { GoogleWatchSettings } from "@/components/locations/suggestions/google-watch-settings"
import { ApiClientError } from "@/lib/api/client"
import * as watchApi from "@/lib/api/google-change-watch"
import type {
  GoogleWatchPerson,
  GoogleWatchSettingsResponse,
} from "@/lib/contracts/google-change-watch"

const LOCATION = "33333333-3333-4333-8333-333333333333"

const OWNER: GoogleWatchPerson = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Olive Owner",
  role: "owner",
}
const MEMBER: GoogleWatchPerson = {
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Mo Member",
  role: "member",
}

const ALL_FIELDS = [
  "name",
  "description",
  "phone",
  "website",
  "primaryCategory",
  "regularHours",
  "specialHours",
] as const

const FIELD_LABELS = [
  "Business name",
  "Description",
  "Phone",
  "Website",
  "Primary category",
  "Opening hours",
  "Special hours",
]

function settingsResponse(
  overrides: {
    settings?: Partial<GoogleWatchSettingsResponse["settings"]>
    canManage?: boolean
    people?: GoogleWatchPerson[]
  } = {}
): GoogleWatchSettingsResponse {
  return {
    settings: {
      protectedFields: [...ALL_FIELDS],
      alertMode: "managers",
      recipientIds: [],
      updatedAt: null,
      updatedBy: null,
      ...overrides.settings,
    },
    canManage: overrides.canManage ?? true,
    people: overrides.people ?? [OWNER, MEMBER],
  }
}

function renderSettings(data: GoogleWatchSettingsResponse) {
  vi.spyOn(watchApi, "fetchGoogleWatchSettings").mockResolvedValue(data)
  return renderWithProviders(<GoogleWatchSettings locationId={LOCATION} />)
}

function isDisabled(element: HTMLElement) {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true"
  )
}

async function saveButton() {
  return screen.findByRole("button", { name: "Save watch settings" })
}

describe("GoogleWatchSettings", () => {
  afterEach(() => vi.restoreAllMocks())

  it("shows an owner every field and every alert choice", async () => {
    renderSettings(settingsResponse())

    expect(
      await screen.findByRole("heading", { name: "What’s watched on Google" })
    ).toBeInTheDocument()
    for (const label of FIELD_LABELS) {
      expect(screen.getByRole("checkbox", { name: label })).toHaveAttribute(
        "aria-checked",
        "true"
      )
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(7)
    expect(
      screen.getByRole("radio", { name: "Owners and admins" })
    ).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByRole("radio", { name: "Everyone who can see this listing" })
    ).toHaveAttribute("aria-checked", "false")
    expect(
      screen.getByRole("radio", { name: "Chosen people" })
    ).toHaveAttribute("aria-checked", "false")
    // No people list until "Chosen people" is chosen.
    expect(screen.queryByRole("checkbox", { name: OWNER.name })).toBeNull()
  })

  it("keeps Save disabled until something changed", async () => {
    const save = vi.spyOn(watchApi, "saveGoogleWatchSettings")
    renderSettings(settingsResponse())

    const button = await saveButton()
    expect(isDisabled(button)).toBe(true)
    await userEvent.click(button)
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Undo changes" })).toBeNull()
  })

  it("saves the fields and alert mode, with no recipients unless chosen", async () => {
    const save = vi
      .spyOn(watchApi, "saveGoogleWatchSettings")
      .mockImplementation(async (_id, input) =>
        settingsResponse({
          settings: {
            protectedFields: [...input.protectedFields],
            alertMode: input.alertMode,
            recipientIds: input.recipientIds ?? [],
          },
        })
      )
    renderSettings(settingsResponse())

    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Website" })
    )
    await userEvent.click(
      screen.getByRole("radio", { name: "Everyone who can see this listing" })
    )
    const button = await saveButton()
    expect(isDisabled(button)).toBe(false)
    await userEvent.click(button)

    await waitFor(() => expect(save).toHaveBeenCalled())
    const [id, input] = save.mock.calls[0]!
    expect(id).toBe(LOCATION)
    expect([...input.protectedFields].sort()).toEqual(
      ALL_FIELDS.filter((field) => field !== "website").sort()
    )
    expect(input.alertMode).toBe("everyone")
    expect(input.recipientIds).toEqual([])
    expect(await screen.findByText("Watch settings saved")).toBeInTheDocument()
  })

  it("drops saved recipients when switching away from chosen people", async () => {
    const save = vi
      .spyOn(watchApi, "saveGoogleWatchSettings")
      .mockResolvedValue(settingsResponse())
    renderSettings(
      settingsResponse({
        settings: { alertMode: "chosen", recipientIds: [OWNER.userId] },
      })
    )

    await userEvent.click(
      await screen.findByRole("radio", { name: "Owners and admins" })
    )
    await userEvent.click(await saveButton())

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]?.[1]).toEqual({
      protectedFields: [...ALL_FIELDS],
      alertMode: "managers",
      recipientIds: [],
    })
  })

  it("asks for at least one person when alerting chosen people, and warns when none can decide", async () => {
    const save = vi
      .spyOn(watchApi, "saveGoogleWatchSettings")
      .mockResolvedValue(settingsResponse())
    renderSettings(settingsResponse())

    await userEvent.click(
      await screen.findByRole("radio", { name: "Chosen people" })
    )
    const owner = screen.getByRole("checkbox", { name: OWNER.name })
    const member = screen.getByRole("checkbox", { name: MEMBER.name })
    expect(owner).toHaveAttribute("aria-checked", "false")
    expect(member).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("Choose at least one person.")).toBeInTheDocument()
    const button = await saveButton()
    expect(isDisabled(button)).toBe(true)
    await userEvent.click(button)
    expect(save).not.toHaveBeenCalled()

    await userEvent.click(member)
    expect(screen.queryByText("Choose at least one person.")).toBeNull()
    expect(
      screen.getByText(
        /None of the people chosen can put ours back or keep Google’s\./
      )
    ).toBeInTheDocument()

    await userEvent.click(owner)
    expect(
      screen.queryByText(
        /None of the people chosen can put ours back or keep Google’s\./
      )
    ).toBeNull()

    await userEvent.click(await saveButton())
    await waitFor(() => expect(save).toHaveBeenCalled())
    const input = save.mock.calls[0]![1]
    expect(input.alertMode).toBe("chosen")
    expect([...(input.recipientIds ?? [])].sort()).toEqual(
      [MEMBER.userId, OWNER.userId].sort()
    )
  })

  it("notes that nothing is watched when every field is unticked", async () => {
    renderSettings(settingsResponse())

    await screen.findByRole("checkbox", { name: "Business name" })
    expect(screen.queryByText(/Nothing is watched\./)).toBeNull()
    for (const label of FIELD_LABELS) {
      await userEvent.click(screen.getByRole("checkbox", { name: label }))
    }
    expect(screen.getByText(/Nothing is watched\./)).toBeInTheDocument()
  })

  it("shows why a save failed", async () => {
    vi.spyOn(watchApi, "saveGoogleWatchSettings").mockRejectedValue(
      new ApiClientError(403, "forbidden", "Only owners and admins")
    )
    renderSettings(settingsResponse())

    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Phone" })
    )
    await userEvent.click(await saveButton())

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Your watch settings weren’t saved.")
    expect(alert).toHaveTextContent("You do not have permission to do that.")
    expect(screen.queryByText("Watch settings saved")).toBeNull()
  })

  it("undoes unsaved changes back to the saved values", async () => {
    renderSettings(settingsResponse())

    const website = await screen.findByRole("checkbox", { name: "Website" })
    await userEvent.click(website)
    await userEvent.click(screen.getByRole("radio", { name: "Chosen people" }))
    expect(screen.getByRole("checkbox", { name: "Website" })).toHaveAttribute(
      "aria-checked",
      "false"
    )

    await userEvent.click(screen.getByRole("button", { name: "Undo changes" }))

    expect(screen.getByRole("checkbox", { name: "Website" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(
      screen.getByRole("radio", { name: "Owners and admins" })
    ).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByRole("checkbox", { name: OWNER.name })).toBeNull()
    expect(isDisabled(await saveButton())).toBe(true)
  })

  it("shows someone who can't manage a read-only summary of fields and alert mode", async () => {
    renderSettings(
      settingsResponse({
        canManage: false,
        settings: { protectedFields: ["name", "phone"], alertMode: "everyone" },
        people: [],
      })
    )

    const watched = await screen.findByText("Watched")
    expect(watched.nextElementSibling).toHaveTextContent("Business name")
    expect(watched.nextElementSibling).toHaveTextContent("Phone")
    expect(watched.nextElementSibling).not.toHaveTextContent("Website")
    const alerts = screen.getByText("Alerts go to")
    expect(alerts.nextElementSibling).toHaveTextContent(
      "Everyone who can see this listing"
    )
    expect(
      screen.queryByRole("button", { name: "Save watch settings" })
    ).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByRole("radio")).toBeNull()
  })

  it("names the chosen people in the read-only summary", async () => {
    renderSettings(
      settingsResponse({
        canManage: false,
        settings: { alertMode: "chosen", recipientIds: [OWNER.userId] },
        people: [OWNER],
      })
    )

    const alerts = await screen.findByText("Alerts go to")
    expect(alerts.nextElementSibling).toHaveTextContent(OWNER.name)
    const section = alerts.closest("dl") as HTMLElement
    expect(within(section).queryByText(MEMBER.name)).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Save watch settings" })
    ).toBeNull()
  })
})
