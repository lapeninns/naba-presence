import { screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import {
  describeChildChange,
  maskLabel,
} from "@/components/bulk/bulk-change-summary"
import { BulkOperationView } from "@/components/bulk/bulk-operation-view"
import type { BulkOperationView as Operation } from "@/lib/contracts/bulk-listings"

vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => "owner",
}))

const child = (overrides: Partial<Operation["children"][number]>) => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  locationId: "00000000-0000-4000-8000-0000000000d1",
  locationName: "Old Crown",
  eligibility: "eligible" as const,
  skipReason: null,
  status: "previewed" as const,
  confirmationState: "unrecorded" as const,
  resultCode: null,
  currentValue: null,
  proposedValue: null,
  updateMask: [],
  attempts: 0,
  finishedAt: null,
  ...overrides,
})

const operation: Operation = {
  id: "00000000-0000-4000-8000-0000000000b1",
  operation: "special_hours",
  input: {
    operation: "special_hours",
    dates: [
      { action: "closed", date: "2026-12-25" },
      {
        action: "open",
        date: "2026-12-26",
        opensAt: "12:00",
        closesAt: "18:00",
      },
    ],
  },
  status: "previewed",
  previewHash: "a".repeat(64),
  requestedBy: "00000000-0000-4000-8000-0000000000e1",
  approvedBy: null,
  requiresSecondApprover: false,
  canApprove: true,
  approvalExpiresAt: "2026-10-02T00:00:00.000Z",
  createdAt: "2026-09-30T00:00:00.000Z",
  finishedAt: null,
  counts: { previewed: 1 },
  children: [
    child({
      currentValue: {
        specialHourPeriods: [
          {
            startDate: { year: 2026, month: 12, day: 26 },
            openTime: { hours: 10 },
            closeTime: { hours: 16 },
          },
        ],
      },
      proposedValue: {
        specialHourPeriods: [
          {
            startDate: { year: 2026, month: 12, day: 25 },
            endDate: { year: 2026, month: 12, day: 25 },
            closed: true,
          },
          {
            startDate: { year: 2026, month: 12, day: 26 },
            endDate: { year: 2026, month: 12, day: 26 },
            openTime: { hours: 12, minutes: 0 },
            closeTime: { hours: 18, minutes: 0 },
            closed: false,
          },
        ],
      },
      updateMask: ["specialHours"],
    }),
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("BulkOperationView", () => {
  it("shows each listing's exact special-hours change, never the raw mask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ operation }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )
    renderWithProviders(<BulkOperationView operationId={operation.id} />)
    const change = await screen.findByRole("list", {
      name: "Change for Old Crown",
    })
    const rows = within(change).getAllByRole("listitem")
    expect(rows.map((row) => row.textContent)).toEqual([
      "Fri, 25 Dec 2026: Not set →changes to Closed",
      "Sat, 26 Dec 2026: Open 10:00–16:00 →changes to Open 12:00–18:00",
    ])
    expect(screen.queryByText(/specialHours/)).not.toBeInTheDocument()
  })
})

describe("describeChildChange", () => {
  it("lists only the weekdays whose regular hours change", () => {
    const period = (day: string, open: number, close: number) => ({
      openDay: day,
      closeDay: day,
      openTime: { hours: open },
      closeTime: { hours: close },
    })
    const rows = describeChildChange(
      "regular_hours",
      { operation: "regular_hours", days: [] } as never,
      {
        currentValue: {
          periods: [period("MONDAY", 9, 17), period("TUESDAY", 9, 17)],
        },
        proposedValue: {
          periods: [period("MONDAY", 9, 17), period("TUESDAY", 10, 22)],
        },
        updateMask: ["regularHours"],
      }
    )
    expect(rows).toEqual([
      { label: "Tuesday", current: "09:00–17:00", proposed: "10:00–22:00" },
    ])
  })

  it("names the service-hours type and its weekly times", () => {
    const rows = describeChildChange(
      "more_hours",
      { operation: "more_hours", hoursTypeId: "HAPPY_HOURS", periods: [] },
      {
        currentValue: [],
        proposedValue: [
          {
            hoursTypeId: "HAPPY_HOURS",
            periods: [
              {
                openDay: "FRIDAY",
                closeDay: "FRIDAY",
                openTime: { hours: 17 },
                closeTime: { hours: 19 },
              },
            ],
          },
        ],
        updateMask: ["moreHours"],
      }
    )
    expect(rows).toEqual([
      { label: "Happy hours", current: "None", proposed: "Fri 17:00–19:00" },
    ])
  })

  it("names attributes and their values", () => {
    const rows = describeChildChange(
      "attributes",
      {
        operation: "attributes",
        changes: [{ name: "attributes/has_wifi", values: [true] }],
      },
      {
        currentValue: [{ name: "attributes/has_wifi", values: [false] }],
        proposedValue: [{ name: "attributes/has_wifi", values: [true] }],
        updateMask: ["attributes/has_wifi"],
      }
    )
    expect(rows).toEqual([
      { label: "Has wifi", current: "No", proposed: "Yes" },
    ])
  })

  it("says which action link is added, updated or removed", () => {
    const input = {
      operation: "place_action" as const,
      action: "upsert" as const,
      placeActionType: "DINING_RESERVATION",
      uri: "https://book.example.test",
      isPreferred: true,
    }
    expect(
      describeChildChange("place_action", input, {
        currentValue: [],
        proposedValue: {
          create: {
            uri: "https://book.example.test",
            placeActionType: "DINING_RESERVATION",
            isPreferred: true,
          },
        },
        updateMask: [],
      })
    ).toEqual([
      {
        label: "Reserve a table",
        current: "No link for this button",
        proposed: "Add https://book.example.test (preferred)",
      },
    ])
    expect(
      describeChildChange(
        "place_action",
        { ...input, action: "delete" },
        {
          currentValue: [
            {
              name: "locations/1/placeActionLinks/9",
              uri: "https://old.example.test",
              isPreferred: false,
            },
          ],
          proposedValue: { delete: "locations/1/placeActionLinks/9" },
          updateMask: ["locations/1/placeActionLinks/9"],
        }
      )
    ).toEqual([
      {
        label: "Reserve a table",
        current: "https://old.example.test",
        proposed: "Removed",
      },
    ])
  })

  it("labels update masks in plain English", () => {
    expect(maskLabel("specialHours")).toBe("Special hours")
    expect(maskLabel("regularHours")).toBe("Opening hours")
    expect(maskLabel("moreHours")).toBe("Service hours")
    expect(maskLabel("attributes/has_wifi")).toBe("Has wifi")
    expect(maskLabel("locations/1/placeActionLinks/9")).toBe(
      "An existing action link"
    )
  })
})
