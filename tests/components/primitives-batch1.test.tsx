import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

describe("Button", () => {
  it("renders an accessible icon-only button", () => {
    render(<Button size="icon-sm" aria-label="Remove period" />)
    expect(
      screen.getByRole("button", { name: "Remove period" })
    ).toBeInTheDocument()
  })
  it("defaults type=button", () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "button"
    )
  })
})

describe("CardTitle", () => {
  it("renders a real heading, h3 by default", () => {
    render(
      <Card>
        <CardTitle>Reply performance</CardTitle>
      </Card>
    )
    expect(
      screen.getByRole("heading", { level: 3, name: "Reply performance" })
    ).toBeInTheDocument()
  })
  it("supports the as prop", () => {
    render(<CardTitle as="h2">Section</CardTitle>)
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument()
  })
})

describe("status variants", () => {
  it("Badge exposes success/warning/info variants", () => {
    render(
      <>
        <Badge variant="success">Published</Badge>
        <Badge variant="warning">Stale</Badge>
        <Badge variant="info">Syncing</Badge>
      </>
    )
    expect(screen.getByText("Published")).toBeInTheDocument()
  })
  it("Alert announces and carries a title", () => {
    render(
      <Alert variant="warning" live>
        <AlertTitle>Data may be out of date</AlertTitle>
        <AlertDescription>Retry to refresh.</AlertDescription>
      </Alert>
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Data may be out of date"
    )
  })
  it("when live, uses role=alert only for interrupting variants, role=status otherwise", () => {
    const { rerender } = render(<Alert variant="destructive" live>Destructive</Alert>)
    expect(screen.getByRole("alert")).toHaveTextContent("Destructive")
    rerender(<Alert variant="warning" live>Warning</Alert>)
    expect(screen.getByRole("alert")).toHaveTextContent("Warning")
    rerender(<Alert variant="info" live>Info</Alert>)
    expect(screen.getByRole("status")).toHaveTextContent("Info")
    rerender(<Alert variant="success" live>Success</Alert>)
    expect(screen.getByRole("status")).toHaveTextContent("Success")
    rerender(<Alert variant="default" live>Default</Alert>)
    expect(screen.getByRole("status")).toHaveTextContent("Default")
  })

  // prim-19: a banner present on load is page content, not an interruption.
  it("is static by default, except a destructive alert, which reports a failure", () => {
    const { container, rerender } = render(<Alert variant="warning">Heads up</Alert>)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="alert"]')).toHaveTextContent("Heads up")
    rerender(<Alert variant="info">Note</Alert>)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    rerender(<Alert variant="destructive">Failed</Alert>)
    expect(screen.getByRole("alert")).toHaveTextContent("Failed")
    rerender(<Alert variant="destructive" live={false}>Static failure</Alert>)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    rerender(<Alert variant="success" live="assertive">Forced</Alert>)
    expect(screen.getByRole("alert")).toHaveTextContent("Forced")
    rerender(<Alert variant="warning" live="polite">Polite</Alert>)
    expect(screen.getByRole("status")).toHaveTextContent("Polite")
  })
})

describe("loading primitives", () => {
  it("Spinner is a named status", () => {
    render(<Spinner />)
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
  })
  it("Skeleton is hidden from AT", () => {
    render(<Skeleton data-testid="sk" className="h-4 w-24" />)
    expect(screen.getByTestId("sk")).toHaveAttribute("aria-hidden", "true")
  })
})
