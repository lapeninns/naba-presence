import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EditorFrame } from "@/components/editors/editor-frame"

const frame = (props: { readView?: boolean; gateReason?: string }) =>
  render(
    <EditorFrame title="Hours" titleHidden {...props}>
      <input aria-label="Name" disabled />
    </EditorFrame>
  )

describe("EditorFrame read view", () => {
  it("is off unless the editor opts in, even when it shows a gate", () => {
    frame({ gateReason: "Publishing is paused." })
    const section = document.querySelector('[data-slot="editor-frame"]')
    expect(section).not.toHaveAttribute("data-read-only")
    expect(section?.className).not.toMatch(/border-transparent/)
  })
  it("styles disabled value fields as plain values when it opts in", () => {
    frame({ readView: true, gateReason: "Only owners and admins can edit." })
    const section = document.querySelector('[data-slot="editor-frame"]')
    expect(section).toHaveAttribute("data-read-only")
    expect(section?.className).toMatch(/:disabled\]:bg-transparent!/)
    // Buttons, switches and checkboxes are never swept in.
    expect(section?.className).not.toMatch(/\[&_\[data-disabled\]\]/)
    expect(screen.getByLabelText("Name")).toBeDisabled()
  })
})
