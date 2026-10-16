import { render, screen } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  isLoadFailure,
  LazyDialogBoundary,
} from "@/components/inbox/lazy-dialog-boundary"
import { Toaster } from "@/components/ui/toast"

function chunkError() {
  const error = new Error("Loading chunk 42 failed.")
  error.name = "ChunkLoadError"
  return error
}

function Boom({ error }: { error: Error }): React.ReactNode {
  throw error
}

/** What the page-level boundary would catch. */
class Outer extends React.Component<
  { children: React.ReactNode },
  { caught: string | null }
> {
  state = { caught: null as string | null }
  static getDerivedStateFromError(error: Error) {
    return { caught: error.message }
  }
  render() {
    return this.state.caught ? (
      <p>page boundary: {this.state.caught}</p>
    ) : (
      this.props.children
    )
  }
}

beforeEach(() => {
  // React reports every caught render error; the tests expect them.
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("isLoadFailure", () => {
  it("recognises a chunk that would not download, and nothing else", () => {
    expect(isLoadFailure(chunkError())).toBe(true)
    expect(
      isLoadFailure(
        new TypeError("Failed to fetch dynamically imported module: /a.js")
      )
    ).toBe(true)
    expect(
      isLoadFailure(new Error("Cannot read properties of undefined"))
    ).toBe(false)
    expect(isLoadFailure("nope")).toBe(false)
  })
})

describe("LazyDialogBoundary", () => {
  it("closes the dialog and says so when its code will not load", () => {
    const onFail = vi.fn()
    render(
      <Toaster>
        <Outer>
          <LazyDialogBoundary what="History" onFail={onFail}>
            <Boom error={chunkError()} />
          </LazyDialogBoundary>
          <p>the page</p>
        </Outer>
      </Toaster>
    )
    expect(onFail).toHaveBeenCalledOnce()
    expect(screen.getByText("Could not open History")).toBeInTheDocument()
    expect(
      screen.getByText("Check your connection and try again.")
    ).toBeInTheDocument()
    // The page carries on: the error did not reach the page-level boundary.
    expect(screen.getByText("the page")).toBeInTheDocument()
    expect(screen.queryByText(/page boundary/)).not.toBeInTheDocument()
  })

  it("leaves a real bug to the page-level boundary, with no toast about the connection", () => {
    const onFail = vi.fn()
    render(
      <Toaster>
        <Outer>
          <LazyDialogBoundary what="History" onFail={onFail}>
            <Boom error={new Error("timeline.map is not a function")} />
          </LazyDialogBoundary>
        </Outer>
      </Toaster>
    )
    expect(onFail).not.toHaveBeenCalled()
    expect(
      screen.getByText("page boundary: timeline.map is not a function")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Could not open/)).not.toBeInTheDocument()
  })

  it("renders its children untouched when nothing fails", () => {
    render(
      <Toaster>
        <LazyDialogBoundary what="History" onFail={() => {}}>
          <p>timeline</p>
        </LazyDialogBoundary>
      </Toaster>
    )
    expect(screen.getByText("timeline")).toBeInTheDocument()
  })
})
