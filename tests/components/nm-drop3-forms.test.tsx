import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
} from "@/components/ui/combobox"
import { FileCard, formatFileSize } from "@/components/ui/file-card"
import { Stepper } from "@/components/ui/stepper"
import { Textarea } from "@/components/ui/textarea"
import {
  TypedConfirmation,
  confirmationMatches,
  type ConfirmationMatch,
} from "@/components/ui/typed-confirmation"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ComboboxContent emptyText", () => {
  function Search({
    emptyText,
    children,
  }: {
    emptyText?: React.ReactNode
    children?: React.ReactNode
  }) {
    return (
      <Combobox items={[] as string[]} search="always" defaultOpen>
        <ComboboxInput aria-label="Search categories" />
        <ComboboxContent emptyText={emptyText}>{children}</ComboboxContent>
      </Combobox>
    )
  }

  it('says "No matches." by default when nothing matches', async () => {
    render(<Search />)
    expect(await screen.findByText("No matches.")).toBeInTheDocument()
  })

  it("takes the caller's words instead", async () => {
    render(<Search emptyText="Couldn't search categories. Try again." />)
    expect(
      await screen.findByText("Couldn't search categories. Try again.")
    ).toBeInTheDocument()
    expect(screen.queryByText("No matches.")).toBeNull()
  })

  it("says nothing with null, so Searching… stands alone", async () => {
    render(
      <Search emptyText={null}>
        <div>Searching…</div>
      </Search>
    )
    expect(await screen.findByText("Searching…")).toBeInTheDocument()
    expect(screen.queryByText("No matches.")).toBeNull()
  })
})

describe("Textarea minRows floor", () => {
  it("floors a one-line growing field at the field height, with no inline minimum", () => {
    render(<Textarea aria-label="Description" autoSize minRows={1} />)
    const el = screen.getByRole("textbox", { name: "Description" })
    expect(el.className).toContain("min-h-(--np-field-h)")
    expect(el.style.minHeight).toBe("")
    expect(el).toHaveStyle({ maxHeight: "280px" })
  })

  it("keeps the measured minimum for two lines or more (already taller than a field)", () => {
    render(<Textarea aria-label="Reply" autoSize minRows={2} />)
    const el = screen.getByRole("textbox", { name: "Reply" })
    expect(el.className).not.toContain("min-h-(--np-field-h)")
    expect(el).toHaveStyle({ minHeight: "60px" })
  })

  it("leaves a fixed (non-growing) textarea alone", () => {
    render(<Textarea aria-label="Notes" minRows={1} />)
    const el = screen.getByRole("textbox", { name: "Notes" })
    expect(el.className).toContain("min-h-24")
    expect(el.className).not.toContain("min-h-(--np-field-h)")
  })
})

describe("confirmationMatches", () => {
  it("keeps the default rule exactly: trimmed, inner spaces collapsed, case-insensitive", () => {
    expect(confirmationMatches("  camden  HOTEL ", "Camden Hotel")).toBe(true)
    expect(confirmationMatches("camden hote", "Camden Hotel")).toBe(false)
    expect(confirmationMatches(" Camden Hotel ", "Camden Hotel", "exact")).toBe(
      true
    )
    expect(confirmationMatches("camden hotel", "Camden Hotel", "exact")).toBe(
      false
    )
  })

  it("trimmed-insensitive trims and lowercases but keeps inner spaces", () => {
    const m: ConfirmationMatch = "trimmed-insensitive"
    expect(confirmationMatches("  CAMDEN hotel  ", "Camden Hotel", m)).toBe(
      true
    )
    expect(confirmationMatches("camden  hotel", "Camden Hotel", m)).toBe(false)
  })

  it.each(["insensitive", "exact", "trimmed-insensitive"] as const)(
    "never matches a blank target in %s mode",
    (mode) => {
      expect(confirmationMatches("", "", mode)).toBe(false)
      expect(confirmationMatches("   ", "   ", mode)).toBe(false)
    }
  )

  it("asks a matcher only when there is a target", () => {
    const matcher = vi.fn(() => true)
    expect(confirmationMatches("", " ", "insensitive", matcher)).toBe(false)
    expect(matcher).not.toHaveBeenCalled()
    expect(confirmationMatches("x", "Camden", "insensitive", matcher)).toBe(
      true
    )
    expect(matcher).toHaveBeenCalledWith("x", "Camden")
  })
})

describe("TypedConfirmation match modes", () => {
  /**
   * A destructive dialog: the button is armed by onMatchChange, so the
   * visible line and the button must agree in every mode.
   */
  function Guard({
    expected,
    match,
    matcher,
  }: {
    expected: string | null
    match?: ConfirmationMatch
    matcher?: (value: string, expected: string) => boolean
  }) {
    const [armed, setArmed] = useState(false)
    return (
      <>
        <TypedConfirmation
          expected={expected}
          match={match}
          matcher={matcher}
          onMatchChange={setArmed}
          label="Type the name"
        />
        <button type="button" disabled={!armed}>
          Remove
        </button>
      </>
    )
  }

  const status = (container: HTMLElement) =>
    container.querySelector(
      '[data-slot="typed-confirmation-status"]'
    ) as HTMLElement

  it.each([
    ["insensitive", "camden  hotel", true],
    ["trimmed-insensitive", "camden  hotel", false],
    ["trimmed-insensitive", " CAMDEN HOTEL ", true],
    ["exact", "camden hotel", false],
    ["exact", " Camden Hotel ", true],
  ] as const)(
    "%s: %j shows Matches and arms the button together (%s)",
    async (match, typed, expected) => {
      const user = userEvent.setup()
      const { container } = render(
        <Guard expected="Camden Hotel" match={match} />
      )
      await user.type(screen.getByLabelText("Type the name"), typed)
      const button = screen.getByRole("button", { name: "Remove" })
      expect(within(status(container)).queryByText("Matches") !== null).toBe(
        expected
      )
      expect(button.hasAttribute("disabled")).toBe(!expected)
    }
  )

  it("uses a caller's matcher for both the line and the button", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Guard expected="Camden Hotel" matcher={(value) => value === "DELETE"} />
    )
    const input = screen.getByLabelText("Type the name")
    await user.type(input, "camden hotel")
    expect(status(container)).not.toHaveTextContent("Matches")
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled()
    await user.clear(input)
    await user.type(input, "DELETE")
    expect(status(container)).toHaveTextContent("Matches")
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled()
  })

  it("never arms with a blank target, even when a matcher would say yes", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Guard expected="  " match="trimmed-insensitive" matcher={() => true} />
    )
    await user.type(screen.getByRole("textbox"), "  ")
    expect(status(container)).not.toHaveTextContent("Matches")
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled()
  })
})

describe("Stepper quiet variant", () => {
  const steps = [
    { id: "a", label: "Request a code", state: "done" as const },
    { id: "b", label: "Enter the PIN", state: "current" as const },
    { id: "c", label: "Verified", state: "todo" as const },
    { id: "d", label: "Video call", state: "skipped" as const },
  ]

  it("states every step in words, the current one marked as the step", () => {
    render(<Stepper variant="quiet" aria-label="Verification" steps={steps} />)
    const list = screen.getByRole("list", { name: "Verification" })
    expect(list).toHaveAttribute("data-variant", "quiet")
    expect(list).toHaveAttribute("data-orientation", "vertical")
    const items = within(list).getAllByRole("listitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Request a codeDone",
      "Enter the PINCurrent",
      "VerifiedTo do",
      "Video callNot needed",
    ])
    expect(items[1]).toHaveAttribute("aria-current", "step")
    expect(
      items.filter((item) => item.hasAttribute("aria-current"))
    ).toHaveLength(1)
    // The marks are decorative; the words carry the state.
    for (const mark of list.querySelectorAll('[data-slot="stepper-mark"]')) {
      expect(mark).toHaveAttribute("aria-hidden", "true")
    }
  })

  it("lets the caller override the words, per list and per step", () => {
    render(
      <Stepper
        variant="quiet"
        stateWords={{ done: "Sent", skipped: "Skipped" }}
        steps={[
          steps[0],
          { ...steps[1], stateLabel: "Waiting for the letter" },
          steps[3],
        ]}
      />
    )
    expect(screen.getByText("Sent")).toBeInTheDocument()
    expect(screen.getByText("Waiting for the letter")).toBeInTheDocument()
    expect(screen.getByText("Skipped")).toBeInTheDocument()
    expect(screen.queryByText("Current")).toBeNull()
  })

  it("leaves the ring stepper unchanged by default", () => {
    render(<Stepper steps={steps.slice(0, 3)} />)
    const list = screen.getByRole("list")
    expect(list).not.toHaveAttribute("data-variant")
    expect(screen.queryByText("Done")).toBeNull()
  })
})

describe("Button block wraps", () => {
  it("wraps a block button's label and grows from the size's height", () => {
    render(<Button block>Request a verification code by post</Button>)
    const button = screen.getByRole("button")
    for (const cls of [
      "w-full",
      "whitespace-normal",
      "text-balance",
      "h-auto",
      "min-h-(--np-control-h)",
    ]) {
      expect(button.className).toContain(cls)
    }
    expect(button.className).not.toContain("whitespace-nowrap")
    expect(button.className).not.toMatch(/(^|\s)h-\(--np-control-h\)/)
  })

  it("keeps the small size's floor", () => {
    expect(buttonVariants({ block: true, size: "sm" })).toContain(
      "min-h-(--np-control-h-sm)"
    )
    expect(buttonVariants({ block: true, size: "lg" })).toContain("min-h-11")
  })

  it("leaves inline and className w-full buttons on one nowrap line", () => {
    render(
      <>
        <Button>Save</Button>
        <Button className="w-full">Continue</Button>
      </>
    )
    for (const name of ["Save", "Continue"]) {
      const button = screen.getByRole("button", { name })
      expect(button.className).toContain("whitespace-nowrap")
      expect(button.className).toContain("h-(--np-control-h)")
      expect(button.className).not.toContain("h-auto")
    }
  })

  it("does not wrap icon sizes", () => {
    expect(buttonVariants({ block: true, size: "icon" })).toContain(
      "whitespace-nowrap"
    )
  })
})

describe("FileCard", () => {
  it("draws name, size · state and a named remove with a touch hit area", async () => {
    const onRemove = vi.fn()
    const user = userEvent.setup()
    render(
      <ul aria-label="Attachments">
        <FileCard
          name="Overview.pdf"
          size={77 * 1024}
          state="Ready"
          onRemove={onRemove}
        />
      </ul>
    )
    const card = screen.getByRole("listitem")
    expect(card).toHaveAttribute("data-slot", "file-card")
    expect(card.className).toContain("rounded-(--np-radius-card)")
    expect(card.className).toContain("border-line")
    expect(
      card.querySelector('[data-slot="file-card-meta"]')
    ).toHaveTextContent("77 KB·Ready")
    const name = card.querySelector('[data-slot="file-card-name"]')!
    expect(name.className).toContain("break-words")
    expect(name.className).not.toMatch(/truncate|line-clamp/)
    const remove = screen.getByRole("button", { name: "Remove Overview.pdf" })
    // icon-sm: 36px drawn, an ::after overhang to 44px on touch.
    expect(remove).toHaveAttribute("data-size", "icon-sm")
    await user.click(remove)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it("draws progress with its state in words and a refusal in the danger ink", () => {
    render(
      <ul>
        <FileCard
          name="bar.jpg"
          progress={{ value: 40, status: "Uploading" }}
        />
        <FileCard name="menu.pdf" refusal="Google takes photos up to 5 MB." />
      </ul>
    )
    const bar = screen.getByRole("progressbar", {
      name: "Upload progress for bar.jpg",
    })
    expect(bar).toHaveAttribute("aria-valuetext", "Uploading, 40%")
    expect(screen.getByText("Uploading")).toBeInTheDocument()
    const refusal = screen
      .getByText("Google takes photos up to 5 MB.")
      .closest('[data-slot="file-card-refusal"]')!
    expect(refusal.className).toContain("text-danger-ink")
    expect(refusal.closest("li")).toHaveAttribute("data-refused", "true")
    // No remove unless asked for.
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("keeps the photos card's regions: meta replaces the line, trailing the corner", () => {
    render(
      <ul>
        <FileCard
          name="a.jpg"
          previewUrl="blob:a"
          previewAlt="a.jpg"
          size={1}
          meta={<span>custom meta</span>}
          trailing={<button type="button">Corner</button>}
          onRemove={() => {}}
        >
          <p>extra</p>
        </FileCard>
      </ul>
    )
    expect(screen.getByRole("img", { name: "a.jpg" })).toHaveAttribute(
      "src",
      "blob:a"
    )
    expect(screen.getByText("custom meta")).toBeInTheDocument()
    expect(screen.queryByText("1 KB")).toBeNull()
    expect(screen.getByRole("button", { name: "Corner" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove a.jpg" })).toBeNull()
    expect(screen.getByText("extra")).toBeInTheDocument()
  })

  it("formats sizes in words", () => {
    expect(formatFileSize(200)).toBe("1 KB")
    expect(formatFileSize(840 * 1024)).toBe("840 KB")
    expect(formatFileSize(3.2 * 1024 * 1024)).toBe("3.2 MB")
  })
})
