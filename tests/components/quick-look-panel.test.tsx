import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import {
  isQuickLookClick,
  QuickLookFact,
  QuickLookFacts,
  QuickLookPanel,
  QuickLookSection,
  useQuickLook,
} from "@/components/ui/quick-look-panel"

/** The viewport, as the shell's matchMedia answers it: wide is `lg` and up. */
function stubWidth(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: wide && query === "(min-width: 64rem)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const plain = {
  button: 0,
  detail: 1,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
}

describe("isQuickLookClick", () => {
  it("accepts a plain primary pointer click", () => {
    expect(isQuickLookClick(plain)).toBe(true)
  })

  it("refuses a keyboard activation, whose click has no detail", () => {
    expect(isQuickLookClick({ ...plain, detail: 0 })).toBe(false)
  })

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "refuses a click with %s held, so a new tab or window still opens",
    (modifier) => {
      expect(isQuickLookClick({ ...plain, [modifier]: true })).toBe(false)
    }
  )

  it("refuses a middle or secondary button", () => {
    expect(isQuickLookClick({ ...plain, button: 1 })).toBe(false)
    expect(isQuickLookClick({ ...plain, button: 2 })).toBe(false)
  })
})

type Row = { id: string; name: string }
const row: Row = { id: "r1", name: "Old Crown Girton" }

function Harness() {
  const quick = useQuickLook<Row>()
  return (
    <>
      <a
        href={`/things/${row.id}`}
        onClick={(event) => quick.intercept(event, row)}
      >
        {row.name}
      </a>
      {quick.item ? (
        <QuickLookPanel
          {...quick.panelProps}
          title={quick.item.name}
          description="3 of 3 listings linked"
          openHref={`/things/${quick.item.id}`}
          openLabel="Open thing"
        >
          <QuickLookSection title="Work">
            <QuickLookFacts>
              <QuickLookFact label="Needs reply">2</QuickLookFact>
            </QuickLookFacts>
          </QuickLookSection>
        </QuickLookPanel>
      ) : null}
    </>
  )
}

describe("useQuickLook", () => {
  it("opens the panel on a plain click from lg, and stops the navigation", async () => {
    stubWidth(true)
    render(<Harness />)
    const link = screen.getByRole("link", { name: "Old Crown Girton" })
    // fireEvent returns false when the click's default was prevented.
    expect(fireEvent.click(link, { detail: 1 })).toBe(false)
    const dialog = await screen.findByRole("dialog", {
      name: "Old Crown Girton",
    })
    expect(dialog).toHaveTextContent("3 of 3 listings linked")
    expect(dialog).toHaveTextContent("Needs reply")
    expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open thing" })).toHaveAttribute(
      "href",
      "/things/r1"
    )
  })

  it("leaves the click alone below lg", () => {
    stubWidth(false)
    render(<Harness />)
    const link = screen.getByRole("link", { name: "Old Crown Girton" })
    expect(fireEvent.click(link, { detail: 1 })).toBe(true)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("leaves a keyboard click alone at lg, so Enter still opens the page", () => {
    stubWidth(true)
    render(<Harness />)
    const link = screen.getByRole("link", { name: "Old Crown Girton" })
    expect(fireEvent.click(link, { detail: 0 })).toBe(true)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("leaves a modifier click alone at lg, so it opens a new tab", () => {
    stubWidth(true)
    render(<Harness />)
    const link = screen.getByRole("link", { name: "Old Crown Girton" })
    expect(fireEvent.click(link, { detail: 1, metaKey: true })).toBe(true)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
