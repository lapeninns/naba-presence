import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"

import { Toaster } from "@/components/ui/toast"

// Shared harness for the M8 console tab tests. Unlike the M4/M5 tab tests
// (which vi.mock the query hooks), these tests exercise the REAL hooks —
// useLocationCapabilities, useBusinessInformation/useIndustry/useAdministration —
// via the GLOBAL fetch stub, so the stubbed URL + response shape MUST match the
// typed client. Retries MUST stay off (retry: false) so an error path resolves
// promptly instead of leaving the query pending. Mirrors the existing
// components/locations/menu-tab.test.tsx renderTab() provider stack.
export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>{ui}</Toaster>
    </QueryClientProvider>
  )
}
