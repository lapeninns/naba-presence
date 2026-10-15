import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { NewClientForm } from "@/components/clients/client-form"
import { Toaster } from "@/components/ui/toast"
import { QueryProvider } from "@/lib/queries/provider"

afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

const renderForm = () =>
  render(
    <QueryProvider>
      <Toaster>
        <NewClientForm />
      </Toaster>
    </QueryProvider>
  )

describe("NewClientForm", () => {
  it("gives the name field touch-friendly keyboard hints", () => {
    renderForm()
    const name = screen.getByRole("textbox", { name: /Client name/ })
    expect(name).toHaveAttribute("autocomplete", "off")
    expect(name).toHaveAttribute("autocapitalize", "words")
    expect(name).toHaveAttribute("enterkeyhint", "go")
  })

  it("asks for a name and keeps focus on the field", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    expect(screen.getByText("Give the client a name.")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /Client name/ })).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("docks the create bar on a phone, with Create client as its primary", () => {
    renderForm()
    const bar = screen.getByRole("region", { name: "Create client" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(
      within(bar).getByRole("button", { name: "Create client" })
    ).toHaveAttribute("type", "submit")
    expect(within(bar).getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/clients"
    )
  })

  it("offers the colour as one radio group named by colour names, with a live preview", () => {
    renderForm()
    const group = screen.getByRole("radiogroup", { name: /Colour/ })
    const radios = within(group).getAllByRole("radio")
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Umber",
      "Pine",
      "Indigo",
      "Plum",
      "Slate blue",
      "Olive",
    ])
    // The swatch, not the radio ring, is what is drawn.
    expect(radios[0]?.className).toMatch(/bg-\(--swatch\)/)
    expect(radios[0]?.className).not.toMatch(/bg-\(--np-field-bg\)/)
    expect(radios[0]?.className).not.toMatch(/border-\[5px\]/)
    // Nothing read out as hex.
    expect(
      screen.queryByRole("radio", { name: /#[0-9A-Fa-f]{6}/ })
    ).not.toBeInTheDocument()
    // The colour derived from the (empty) name is the one shown as chosen.
    expect(radios.filter((radio) => radio.ariaChecked === "true")).toHaveLength(
      1
    )
    const preview = document.querySelector(
      "[data-slot=client-avatar]"
    ) as HTMLElement
    expect(preview.style.getPropertyValue("--client-mark")).toBe("#7A4E3B")
    fireEvent.click(within(group).getByRole("radio", { name: "Plum" }))
    expect(within(group).getByRole("radio", { name: "Plum" })).toBeChecked()
    expect(preview.style.getPropertyValue("--client-mark")).toBe("#6B4A6B")
    fireEvent.click(
      screen.getByRole("button", { name: "Use the automatic colour" })
    )
    expect(preview.style.getPropertyValue("--client-mark")).toBe("#7A4E3B")
  })

  it("sends the colour only once one is picked", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            client: {
              id: "c9",
              name: "Old Crown Group",
              slug: "old-crown-group",
              colour: "#3F5E52",
              logoUrl: null,
              notes: null,
              archivedAt: null,
              createdAt: "2026-01-01",
              locationCount: 0,
              linkedCount: 0,
              verifiedCount: 0,
              health: "healthy",
              connections: [],
              openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
              backfill: { running: 0, failed: 0, succeeded: 0, notStarted: 0 },
              lastSyncAt: null,
            },
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    renderForm()
    fireEvent.change(screen.getByRole("textbox", { name: /Client name/ }), {
      target: { value: "Old Crown Group" },
    })
    fireEvent.click(screen.getByRole("radio", { name: "Pine" }))
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/api/clients") && init?.method === "POST"
    )
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: "Old Crown Group",
      colour: "#3F5E52",
    })
  })

  it("asks before Cancel throws away what was typed, and not when nothing was", async () => {
    renderForm()
    // Clean: Cancel is just a link, no prompt.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: /Notes/ }), {
      target: { value: "Prefers email" },
    })
    const reload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }))
    const prompt = await screen.findByRole("alertdialog", {
      name: "Leave without creating the client?",
    })
    fireEvent.click(
      within(prompt).getByRole("button", { name: "Keep editing" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("textbox", { name: /Notes/ })).toHaveValue(
      "Prefers email"
    )
  })

  it("explains the next steps as an ordered list", () => {
    renderForm()
    expect(
      screen.getByRole("heading", { name: "What happens next" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })
})
