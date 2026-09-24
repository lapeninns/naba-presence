import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

import { AgencyNameForm } from "@/components/settings/agency-name-form"
import { Toaster } from "@/components/ui/toast"
import * as sessionApi from "@/lib/api/session"
import { queryKeys } from "@/lib/queries/keys"

function renderForm(role: "owner" | "admin") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, {
    session: {
      userId: "u1",
      organisationId: "o1",
      organisationName: "Aman's organisation",
      displayName: "Aman",
      email: "aman@example.test",
      role,
      canPublish: true,
    },
  })
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <AgencyNameForm />
      </Toaster>
    </QueryClientProvider>
  )
  return client
}

afterEach(() => {
  vi.restoreAllMocks()
  refresh.mockReset()
})

describe("AgencyNameForm", () => {
  it("lets an owner rename the agency and updates the cached session", async () => {
    const spy = vi
      .spyOn(sessionApi, "renameOrganisation")
      .mockResolvedValue({ organisationId: "o1", name: "Lapen Inns" })
    const client = renderForm("owner")
    const input = screen.getByRole("textbox", { name: "Agency name" })
    expect(input).toHaveValue("Aman's organisation")
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled()
    fireEvent.change(input, { target: { value: "  Lapen Inns " } })
    fireEvent.click(screen.getByRole("button", { name: "Save name" }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith("Lapen Inns"))
    await waitFor(() =>
      expect(
        client.getQueryData<{ session: { organisationName: string } }>(
          queryKeys.session
        )?.session.organisationName
      ).toBe("Lapen Inns")
    )
    expect(refresh).toHaveBeenCalled()
  })

  it("refuses an empty name without calling the API", () => {
    const spy = vi.spyOn(sessionApi, "renameOrganisation")
    renderForm("owner")
    fireEvent.change(screen.getByRole("textbox", { name: "Agency name" }), {
      target: { value: "   " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save name" }))
    expect(screen.getByText("Enter your agency’s name.")).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it("is read-only for anyone but an owner", () => {
    renderForm("admin")
    expect(
      screen.getByRole("textbox", { name: "Agency name" })
    ).toHaveAttribute("readonly")
    expect(
      screen.queryByRole("button", { name: "Save name" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("Only an owner can rename the agency.")
    ).toBeInTheDocument()
  })
})
