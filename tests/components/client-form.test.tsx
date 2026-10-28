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

const CLIENT = {
  id: "c9",
  name: "Old Crown Group",
  slug: "old-crown-group",
  colour: null,
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
}

/**
 * Answers the create POST with `answer` (which may throw, as fetch does when
 * the connection drops); any other request gets an empty 200. Returns a spy
 * that counts the create POSTs alone.
 */
function stubCreate(answer: () => Response) {
  const post = vi.fn(answer)
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) =>
      String(input).includes("/api/clients") && init?.method === "POST"
        ? post()
        : new Response("{}", { status: 200 })
    )
  )
  return post
}

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

  it("says in the docked bar that nothing is sent to Google", () => {
    renderForm()
    const bar = screen.getByRole("region", { name: "Create client" })
    expect(within(bar).getByText("Nothing is sent to Google.")).toBeVisible()
  })

  it("puts a taken name on the name field, focuses it, and clears it on edit", async () => {
    stubCreate(
      () =>
        new Response(
          JSON.stringify({
            error: "client_name_taken",
            message: "A client with that name already exists.",
            fieldErrors: { name: "A client with that name already exists." },
          }),
          { status: 409 }
        )
    )
    renderForm()
    const name = screen.getByRole("textbox", { name: /Client name/ })
    fireEvent.change(name, { target: { value: "  Old Crown Group " } })
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"))
    expect(name).toHaveFocus()
    expect(name).toHaveAccessibleDescription(
      /There’s already a client called “Old Crown Group”\. Archived clients count too/
    )
    // On the field, not as the page alert (the field error is its own alert).
    expect(screen.queryByText(/wasn’t created/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Refresh/)).not.toBeInTheDocument()
    fireEvent.change(name, { target: { value: "Old Crown Group 2" } })
    await waitFor(() =>
      expect(name).not.toHaveAttribute("aria-invalid", "true")
    )
    expect(
      screen.queryByText(/already a client called/)
    ).not.toBeInTheDocument()
  })

  it("does not say nothing was added when the connection dropped", async () => {
    stubCreate(() => {
      throw new TypeError("Failed to fetch")
    })
    renderForm()
    fireEvent.change(screen.getByRole("textbox", { name: /Client name/ }), {
      target: { value: "Old Crown Group" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(
      "We couldn’t confirm the client was created"
    )
    expect(alert).toHaveTextContent(/Check Clients before trying again/)
    expect(alert).not.toHaveTextContent(/Nothing was added/)
    expect(screen.getByRole("textbox", { name: /Client name/ })).toHaveValue(
      "Old Crown Group"
    )
  })

  it("does not blame Google when the server refuses with a typed 5xx", async () => {
    stubCreate(
      () =>
        new Response(
          JSON.stringify({
            error: "service_unavailable",
            message: "Down for a moment.",
          }),
          { status: 503 }
        )
    )
    renderForm()
    fireEvent.change(screen.getByRole("textbox", { name: /Client name/ }), {
      target: { value: "Old Crown Group" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("The client wasn’t created")
    expect(alert).toHaveTextContent(/Nothing was added/)
    expect(alert).not.toHaveTextContent(/Google/)
  })

  it("stays pending after the client is created, so a second tap posts nothing", async () => {
    const post = stubCreate(
      () => new Response(JSON.stringify({ client: CLIENT }), { status: 200 })
    )
    renderForm()
    fireEvent.change(screen.getByRole("textbox", { name: /Client name/ }), {
      target: { value: "Old Crown Group" },
    })
    const form = screen.getByRole("form", { name: "New client" })
    fireEvent.submit(form)
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    // The route has not changed yet (push is a mock): the button still
    // reads as working, and submitting again does nothing.
    const bar = screen.getByRole("region", { name: "Create client" })
    expect(within(bar).getByRole("button")).toHaveAttribute("aria-busy", "true")
    fireEvent.submit(form)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(post).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it("explains the next steps as an ordered list", () => {
    renderForm()
    expect(
      screen.getByRole("heading", { name: "What happens next" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })
})
