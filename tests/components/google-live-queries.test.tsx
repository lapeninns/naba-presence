import { QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GOOGLE_LIVE_READ } from "@/lib/queries/google-live"
import { makeQueryClient } from "@/lib/queries/query-client"
import {
  DISCOVERY_READ,
  useGoogleAccounts,
} from "@/lib/queries/use-google-accounts"
import { useGoogleLocations } from "@/lib/queries/use-google-locations"
import { usePlaceActions } from "@/lib/queries/use-location-booking"
import {
  useBusinessInformation,
  useBusinessInformationMetadata,
} from "@/lib/queries/use-location-business-information"
import { useHours } from "@/lib/queries/use-location-hours"
import { useMedia } from "@/lib/queries/use-location-media"
import { useFoodMenus } from "@/lib/queries/use-location-menu"
import { usePosts } from "@/lib/queries/use-location-posts"
import { useProfile } from "@/lib/queries/use-location-profile"

/**
 * W5-07 / W3-01: a query whose read reaches Google live must not repeat that
 * read because the operator came back to the tab, and discovery (which pages
 * every account and rewrites the rows) runs only when asked.
 */

const LOCATION = "00000000-0000-4000-8000-000000000001"

function observerOptions(hook: () => unknown) {
  const client = makeQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  renderHook(hook, { wrapper })
  const [query] = client.getQueryCache().findAll()
  return query.observers[0].options
}

beforeEach(() => {
  // Never answers: only the options are under test.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {}))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Google-backed tab queries", () => {
  it.each([
    ["hours", () => useHours(LOCATION)],
    ["profile", () => useProfile(LOCATION)],
    ["menus", () => useFoodMenus(LOCATION)],
    ["place actions", () => usePlaceActions(LOCATION)],
    ["business information", () => useBusinessInformation(LOCATION)],
    [
      "category search",
      () => useBusinessInformationMetadata(LOCATION, "categories", "pub"),
    ],
    ["photos", () => useMedia(LOCATION)],
    ["posts", () => usePosts(LOCATION)],
  ])("%s stays fresh for five minutes and skips focus refetches", (_, hook) => {
    const options = observerOptions(hook)
    expect(options.staleTime).toBe(GOOGLE_LIVE_READ.staleTime)
    expect(GOOGLE_LIVE_READ.staleTime).toBe(5 * 60_000)
    expect(options.refetchOnWindowFocus).toBe(false)
  })
})

describe("Google discovery queries", () => {
  it.each([
    ["accounts", () => useGoogleAccounts("conn-1").query],
    ["locations", () => useGoogleLocations("accounts/1")],
  ])("%s never go stale, refetch on focus or retry on their own", (_, hook) => {
    const options = observerOptions(hook)
    expect(options).toMatchObject(DISCOVERY_READ)
    expect(options.staleTime).toBe(Infinity)
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.retry).toBe(0)
  })
})
