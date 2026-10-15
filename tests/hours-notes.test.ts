import { describe, expect, it } from "vitest"

import {
  hoursNotes,
  SERVICE_OPTIONS_WARNING,
  serviceNote,
} from "@/lib/editors/hours-notes"

const clean = {
  status: "in_sync" as const,
  warnings: [] as string[],
  reconciliationRequired: false,
}

describe("hoursNotes", () => {
  it("says 'No hours on Google' and what customers see", () => {
    const [note] = hoursNotes(clean, { gated: false, googleEmpty: true })
    expect(note?.title).toBe("No hours on Google")
    expect(note?.description).toMatch(/Google shows no hours yet/)
  })

  it("keeps the service-options note off the weekly schedule", () => {
    const hours = { ...clean, warnings: [SERVICE_OPTIONS_WARNING] }
    expect(hoursNotes(hours, { gated: false, googleEmpty: false })).toEqual([])
    expect(serviceNote(hours.warnings)).toBe(SERVICE_OPTIONS_WARNING)
  })

  it("has no service note when the options loaded", () => {
    expect(serviceNote(["Another warning"])).toBeNull()
    expect(SERVICE_OPTIONS_WARNING).not.toMatch(/metadata|lookup/i)
  })
})
