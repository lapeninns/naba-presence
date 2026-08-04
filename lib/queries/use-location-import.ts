"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { linkExternalLocation, unlinkExternalLocation } from "@/lib/api/location-links"
import { queryKeys } from "./keys"

// The server falls back to a fixed default timezone when none is supplied
// (see POST /api/location-links) — fine for a manual single-location setup,
// wrong for an org importing locations that aren't in that zone. Send the
// browser's real IANA zone whenever the runtime can resolve one so a fresh
// import lands with an honest timezone instead of a silent mis-default;
// `undefined` (old runtimes, non-browser test environments) falls back to
// the server default rather than sending a bogus value.
//
// Intended behaviour (documented deferral — see the M9 closeout ledger):
// this should send the imported Google location's OWN timezone rather than
// the importing browser's. It doesn't today because that data isn't
// available anywhere in this hook's reach: `DiscoveredLocation` (from
// GET /api/google/locations) carries no timezone field, the Google
// Business Profile Location resource doesn't expose an IANA zone directly
// (it would need deriving from the storefront address / lat-lng via a
// geocoding+timezone lookup), and threading that through would mean
// extending a protected discovery route's response contract — out of
// reach for a same-layer fix here.
function resolveClientTimezone(): string | undefined {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return undefined
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

export function useLocationImport() {
  const client = useQueryClient()
  // One invalidation, not two: `locationsManagement` is ["location-directory",
  // "management"], a prefix-child of `locations` (["location-directory"]), and
  // React Query matches by prefix — so this already covers both directory
  // views. It no longer reaches the ["locations", <id>, …] resource keys,
  // which a link/unlink has no reason to drop.
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.locations })
  const link = useMutation({
    mutationFn: (input: { externalLocationId: string; confirmRelink?: boolean }) =>
      linkExternalLocation({ ...input, timezone: resolveClientTimezone() }),
    onSuccess: invalidate,
  })
  const unlink = useMutation({
    mutationFn: (externalLocationId: string) => unlinkExternalLocation(externalLocationId),
    onSuccess: invalidate,
  })
  return { link, unlink }
}
