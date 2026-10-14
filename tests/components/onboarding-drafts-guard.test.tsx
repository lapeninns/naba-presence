import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ACCOUNT = "6f1d4c55-9a43-4f8e-8f2b-7a104b0c7f0e"
const DRAFT = "9a434f8e-1f2b-4a10-8b0c-7f0e6f1d4c55"
const CONNECTION = "4b0c7f0e-6f1d-4c55-9a43-1f8e1f2b7a10"
const CLIENT = "1f2b7a10-4b0c-4f0e-8f1d-4c559a431f8e"
const USER = "7a104b0c-7f0e-4f1d-8c55-9a431f8e1f2b"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams({ onboardingAccount: ACCOUNT, onboardingDraft: DRAFT }),
  usePathname: () => "/setup",
}))
const never = vi.hoisted(() => () => new Promise<never>(() => {}))
vi.mock("@/lib/api/google-onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/google-onboarding")>()),
  fetchOnboardingDraft: vi.fn(never),
  fetchOnboardingDrafts: vi.fn(never),
  // Nothing created and no link under way: the draft's own form shows.
  fetchOnboardingCreation: vi.fn(async () => null),
}))
vi.mock("@/lib/api/google-onboarding-match-link", () => ({
  fetchOnboardingMatchLink: vi.fn(async () => null),
}))

import { OnboardingDrafts } from "@/components/setup/onboarding-drafts"
import { Toaster } from "@/components/ui/toast"
import { __resetDraftSources, abandonAllDrafts } from "@/lib/api/draft-stash"
import { __resetLeaveGuardForTests } from "@/lib/editors/use-leave-guard"
import { queryKeys } from "@/lib/queries/keys"

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => __resetLeaveGuardForTests())

function renderDraft() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.googleAccounts(CONNECTION), {
    accounts: [
      {
        id: ACCOUNT,
        googleConnectionId: CONNECTION,
        googleAccountName: "accounts/1",
        accountName: "Old Crown",
        isActive: true,
      },
    ],
  })
  client.setQueryData(["google-onboarding-draft", ACCOUNT, DRAFT], {
    id: DRAFT,
    accountId: ACCOUNT,
    accountName: "Old Crown",
    connectionId: CONNECTION,
    clientId: CLIENT,
    requestedBy: USER,
    providerRequestId: USER,
    revision: 1,
    payload: { languageCode: "en-GB" },
    payloadHash: "a".repeat(64),
    matchResult: null,
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
    expiresAt: "2026-11-14T10:00:00.000Z",
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <OnboardingDrafts
          clientId={CLIENT}
          connectionId={CONNECTION}
          onDirtyChange={() => {}}
        />
      </Toaster>
    </QueryClientProvider>
  )
}

function reloadWarns() {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe("OnboardingDrafts unsaved changes", () => {
  it("warns on a reload while the draft has unsaved edits", async () => {
    renderDraft()
    const name = await screen.findByLabelText("Business name")
    expect(reloadWarns()).toBe(false)
    fireEvent.change(name, { target: { value: "The Old Crown" } })
    expect(reloadWarns()).toBe(true)
    // Not stashed: the draft itself is saved on the server.
    expect(Object.keys(sessionStorage)).toEqual([])
  })

  it("does not ask to stay once a forced sign-out has abandoned the drafts", async () => {
    renderDraft()
    fireEvent.change(await screen.findByLabelText("Business name"), {
      target: { value: "The Old Crown" },
    })
    abandonAllDrafts()
    expect(reloadWarns()).toBe(false)
  })
})
