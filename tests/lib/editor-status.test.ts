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

  it("says 'No hours on Google' instead of 'In sync' when both sides are empty", () => {
    expect(
      editorStatusPill({ ...base, emptyOnGoogle: "No hours on Google" })
    ).toEqual({ tone: "attention", label: "No hours on Google" })
    // Edits still win: the operator is mid-change.
    expect(
      editorStatusPill({
        ...base,
        status: "edited",
        isDirty: true,
        localEdits: true,
        emptyOnGoogle: "No hours on Google",
      })
    ).toEqual({ tone: "neutral", label: "Unsaved changes", state: "unsaved" })
  })

  it("says unsaved changes over any 'in sync' while the tab holds edits", () => {
    expect(
      editorStatusPill({
        ...base,
        status: "edited",
        isDirty: true,
        localEdits: true,
      })
    ).toEqual({ tone: "neutral", label: "Unsaved changes", state: "unsaved" })
  })

  it("says draft saved once the edits are saved", () => {
    expect(
      editorStatusPill({ ...base, status: "edited", isDirty: true })
    ).toEqual({ tone: "neutral", label: "Draft saved", state: "saved_locally" })
    expect(
      editorStatusPill({
        ...base,
        savesHere: false,
        status: "unpublished",
        isDirty: true,
      })
    ).toEqual({ tone: "neutral", label: "Draft saved", state: "saved_locally" })
  })

  it("names a conflict and a change made on Google", () => {
    expect(
      editorStatusPill({
        ...base,
        status: "conflict",
        isDirty: true,
        localEdits: true,
      })?.label
    ).toBe("Changed on Google")
    expect(
      editorStatusPill({ ...base, status: "google_dirty", isDirty: true })
        ?.label
    ).toBe("Changed on Google")
  })

  it("claims in sync only when the editor compared and found no difference", () => {
    expect(editorStatusPill(base)).toEqual({
      tone: "healthy",
      label: "In sync",
    })
    expect(editorStatusPill({ ...base, status: "edited" })).toBeNull()
  })
})
