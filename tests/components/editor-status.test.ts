import { describe, expect, it } from "vitest"

import {
  editorStatusPill,
  type EditorStatusReport,
} from "@/components/editors/editor-status"

const base: EditorStatusReport = {
  status: "in_sync",
  isDirty: false,
  localEdits: false,
  savesHere: true,
}

describe("editorStatusPill", () => {
  it("leaves the header to the summary when there is no editor", () => {
    expect(editorStatusPill(null)).toBeNull()
  })

  it("says unsaved edits over any 'in sync' while the tab holds edits", () => {
    expect(
      editorStatusPill({
        ...base,
        status: "edited",
        isDirty: true,
        localEdits: true,
      })
    ).toEqual({ tone: "pending", label: "Unsaved edits" })
  })

  it("says saved here, not on Google once the edits are saved", () => {
    expect(
      editorStatusPill({ ...base, status: "edited", isDirty: true })
    ).toEqual({ tone: "pending", label: "Saved here, not on Google" })
    expect(
      editorStatusPill({
        ...base,
        savesHere: false,
        status: "unpublished",
        isDirty: true,
      })
    ).toEqual({ tone: "pending", label: "Saved here, not on Google" })
  })

  it("names a conflict and a change made on Google", () => {
    expect(
      editorStatusPill({
        ...base,
        status: "conflict",
        isDirty: true,
        localEdits: true,
      })?.label
    ).toBe("Conflict with Google")
    expect(
      editorStatusPill({ ...base, status: "google_dirty", isDirty: true })
        ?.label
    ).toBe("Changed on Google")
  })

  it("claims in sync only when the editor compared and found no difference", () => {
    expect(editorStatusPill(base)).toEqual({
      tone: "healthy",
      label: "In sync with Google",
    })
    expect(editorStatusPill({ ...base, status: "edited" })).toBeNull()
  })
})
