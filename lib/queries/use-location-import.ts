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
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.locationsManagement }),
      client.invalidateQueries({ queryKey: queryKeys.locations }),
    ])
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
