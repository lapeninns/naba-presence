import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ClientAvatar } from "@/components/clients/client-avatar"

const mark = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="client-avatar"]')!

describe("ClientAvatar", () => {
  it("chooses the ink that reads on the chosen colour", () => {
    const dark = mark(
      render(<ClientAvatar name="Old Crown" colour="#3F5E52" />).container
    )
    expect(dark.style.getPropertyValue("--client-mark")).toBe("#3F5E52")
    expect(dark.style.getPropertyValue("--client-mark-ink")).toBe("#FFFFFF")
    const light = mark(
      render(<ClientAvatar name="Old Crown" colour="#F4E7B8" />).container
    )
    expect(light.style.getPropertyValue("--client-mark-ink")).toBe("#1A1714")
  })

  it("keeps the ink colour beside the size utility after class merging", () => {
    // A merged-away colour is how the initials once shipped unreadable.
    const el = mark(render(<ClientAvatar name="Old Crown" />).container)
    expect(el.className).toContain("text-(color:--client-mark-ink)")
    expect(el.className).toContain("text-ui")
    expect(el.className).toContain("bg-(--client-mark)")
  })

  it("skips a leading 'The', and uses one letter at the inline size", () => {
    expect(
      mark(render(<ClientAvatar name="The Barley Mow" />).container)
    ).toHaveTextContent("BM")
    const xs = mark(
      render(<ClientAvatar name="The Barley Mow" size="xs" />).container
    )
    expect(xs).toHaveTextContent(/^B$/)
    expect(xs.className).toContain("text-caption")
  })
})
