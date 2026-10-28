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
    const [note] = hoursNotes(clean, {
      gated: false,
      googleEmpty: true,
      draftEmpty: true,
    })
    expect(note?.title).toBe("No hours on Google")
    expect(note?.description).toMatch(/Google shows no hours yet/)
    expect(note?.description).toMatch(/Switch on your open days/)
  })

  it("tells an operator with hours waiting to publish them, not to switch days on", () => {
    const [note] = hoursNotes(clean, {
      gated: false,
      googleEmpty: true,
      draftEmpty: false,
    })
    expect(note?.title).toBe("No hours on Google")
    expect(note?.description).not.toMatch(/Switch on/)
    expect(note?.description).toMatch(
      /Review and publish these hours to put them on Google/
    )
  })

  it("explains a Google-side change and offers to keep it", () => {
    const notes = hoursNotes(
      { ...clean, status: "google_dirty" },
      { gated: false, googleEmpty: false, draftEmpty: false }
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      key: "google-changed",
      tone: "warning",
      title: "Hours changed on Google",
      action: "keep-google",
    })
    expect(notes[0]?.description).toMatch(/Keep Google’s hours/)
  })

  it("offers no keep action when Google removed every hour", () => {
    const notes = hoursNotes(
      { ...clean, status: "google_dirty" },
      { gated: false, googleEmpty: true, draftEmpty: false }
    )
    // The Google-changed note says the hours were removed: no second
    // "No hours on Google" note beside it.
    expect(notes.map((note) => note.key)).toEqual(["google-changed"])
    expect(notes[0]?.action).toBeUndefined()
    expect(notes[0]?.description).toMatch(/removed these hours on Google/)
  })

  it("says nothing about a Google change to a role that cannot act on it", () => {
    expect(
      hoursNotes(
        { ...clean, status: "google_dirty" },
        { gated: true, googleEmpty: false, draftEmpty: false }
      )
    ).toEqual([])
  })

  it("keeps the service-options note off the weekly schedule", () => {
    const hours = { ...clean, warnings: [SERVICE_OPTIONS_WARNING] }
    expect(
      hoursNotes(hours, { gated: false, googleEmpty: false, draftEmpty: false })
    ).toEqual([])
    expect(serviceNote(hours.warnings)).toBe(SERVICE_OPTIONS_WARNING)
  })

  it("has no service note when the options loaded", () => {
    expect(serviceNote(["Another warning"])).toBeNull()
    expect(SERVICE_OPTIONS_WARNING).not.toMatch(/metadata|lookup/i)
  })
})
