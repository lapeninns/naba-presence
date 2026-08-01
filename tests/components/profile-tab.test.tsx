import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProfileTab } from "@/components/locations/profile-tab"
import { Toaster } from "@/components/ui/toast"
import type { ProfileState } from "@/lib/api/location-profile"

const useProfileMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-profile", () => ({ useProfile: () => useProfileMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeProfile(overrides: Partial<ProfileState> = {}): ProfileState {
  const field = (key: string, status: ProfileState["fields"][number]["status"], canonicalValue: string | null, googleValue: string | null) => ({
    key: key as ProfileState["fields"][number]["key"],
    policy: "bidirectional" as const,
    status,
    canonicalValue,
    googleValue,
    canonicalHash: "c",
    googleHash: "g",
    lastReconciledAt: null,
  })
  return {
    location: { id: "loc-1", name: "Riverside", googleLocationName: "locations/1" },
    canonicalResource: { revision: "3", updatedAt: "2026-08-01T00:00:00.000Z" },
    canonicalHash: "ch",
    googleHash: "gh",
    canPublish: true,
    googleWritesEnabled: true,
    fields: [
      field("name", "core_dirty", "Riverside Rooms", "Riverside"),
      field("description", "in_sync", "A calm stay", "A calm stay"),
      field("phone", "in_sync", "+44 20 7946 0000", "+44 20 7946 0000"),
      field("website", "in_sync", "https://riverside.test", "https://riverside.test"),
      { ...field("address", "in_sync", "1 River Rd", "1 River Rd"), policy: "import_only" },
      { ...field("mapsUrl", "in_sync", null, null), policy: "import_only" },
      { ...field("reviewUrl", "in_sync", null, null), policy: "import_only" },
    ],
    googleDetails: { primaryCategory: "Hotel", additionalCategories: [] },
    latestAttempt: null,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ProfileTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ProfileTab", () => {
  it("renders the field diff and enables save once an owner edits a field", () => {
    useProfileMock.mockReturnValue({ data: makeProfile(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("columnheader", { name: "Google" })).toBeInTheDocument()
    // name is core_dirty in the fixture -> the diff shows the "Edited here" chip.
    expect(screen.getByText("Edited here")).toBeInTheDocument()
    const name = screen.getByRole("textbox", { name: "Business name" })
    expect(name).toHaveValue("Riverside Rooms")
    // Clean form -> save is disabled; editing makes it dirty -> enabled.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    fireEvent.change(name, { target: { value: "Riverside Rooms & Spa" } })
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
    expect(screen.queryByText("Only owners and admins can edit this location.")).not.toBeInTheDocument()
  })

  it("disables save and publish with reasons for a viewer and disables the inputs", () => {
    useProfileMock.mockReturnValue({ data: makeProfile(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("textbox", { name: "Business name" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(screen.getByText("Only owners and admins can edit this location.")).toBeInTheDocument()
  })

  it("keeps canonical save available but publish disabled when Google writes are unavailable", () => {
    useProfileMock.mockReturnValue({ data: makeProfile({ googleWritesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    // Editing is still allowed with Google writes off (canonical save works).
    fireEvent.change(screen.getByRole("textbox", { name: "Business name" }), { target: { value: "Riverside Rooms & Spa" } })
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(screen.getByText("Publishing to Google is currently unavailable.")).toBeInTheDocument()
  })
})
