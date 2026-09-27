import { fireEvent, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useKeepFocusClear } from "@/lib/editors/use-keep-focus-clear"

function Harness() {
  const root = useRef<HTMLDivElement>(null)
  useKeepFocusClear(root)
  return (
    <div ref={root}>
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <div data-slot="field" data-testid="field">
          <input aria-label="Item name" />
          <p>Give this item a name.</p>
        </div>
      </div>
      <div data-slot="editor-frame-footer" data-testid="footer" />
    </div>
  )
}

function bounds(element: Element, top: number, bottom: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 300,
    width: 300,
    x: 0,
    y: top,
    toJSON: () => ({}),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("focused editor fields", () => {
  it("keeps the helper above a clipped scroll pane when the footer is below the viewport", () => {
    vi.stubGlobal("innerHeight", 390)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    render(<Harness />)
    const scroller = screen.getByTestId("scroller")
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 390 },
      clientTop: { value: 0 },
      scrollBy: { value: vi.fn() },
    })
    bounds(scroller, -32, 358)
    bounds(screen.getByTestId("field"), 285.5, 377.5)
    bounds(screen.getByRole("textbox"), 305.5, 341.5)
    bounds(screen.getByTestId("footer"), 541.5, 601.5)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 31.5 })
  })

  it("keeps the footer as the tighter boundary within a taller scroll pane", () => {
    vi.stubGlobal("innerHeight", 1000)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    render(<Harness />)
    const scroller = screen.getByTestId("scroller")
    Object.defineProperties(scroller, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 692 },
      clientTop: { value: 0 },
      scrollBy: { value: vi.fn() },
    })
    bounds(scroller, 308, 1000)
    bounds(screen.getByTestId("field"), 832, 908)
    bounds(screen.getByRole("textbox"), 852, 888)
    bounds(screen.getByTestId("footer"), 900, 960)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 20 })
  })

  it("uses window scrolling when no inner scroll pane exists", () => {
    vi.stubGlobal("innerHeight", 1000)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {})
    render(<Harness />)
    bounds(screen.getByTestId("field"), 832, 908)
    bounds(screen.getByRole("textbox"), 852, 888)
    bounds(screen.getByTestId("footer"), 900, 960)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroll).toHaveBeenCalledWith({ top: 20 })
  })

  it("retains top clearance when the field is above the toolbar", () => {
    vi.stubGlobal("innerHeight", 1000)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    render(<Harness />)
    const scroller = screen.getByTestId("scroller")
    Object.defineProperties(scroller, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 1000 },
      clientTop: { value: 0 },
      scrollBy: { value: vi.fn() },
    })
    bounds(scroller, 0, 1000)
    bounds(screen.getByTestId("field"), 10, 86)
    bounds(screen.getByRole("textbox"), 30, 66)
    bounds(screen.getByTestId("footer"), 900, 960)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: -42 })
  })
})
