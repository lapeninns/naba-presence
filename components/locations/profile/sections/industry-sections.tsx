"use client"

import dynamic from "next/dynamic"
import { useEffect } from "react"

import { TabError } from "@/components/locations/tab-states"
import { tabGateReasons, type LocationCapabilities } from "@/lib/locations/gating"
import { useIndustry } from "@/lib/queries/use-location-industry"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"

export { INDUSTRY_LODGING_ID } from "./industry-section-ids"

// The lodging editor carries the Google lodging discovery schema (about
// 100 KB), and most listings are not lodging. The profile mounts this
// section only for a listing whose categories allow lodging, so the chunk
// starts loading then, alongside the industry request, instead of on every
// profile. Nothing is rendered while that request is pending either, so the
// null fallback matches.
const loadIndustryEditor = () => import("./industry-editor")
const IndustryEditor = dynamic(
  () => loadIndustryEditor().then((m) => m.IndustryEditor),
  { loading: () => null }
)

export function IndustrySections({ locationId, enabled = true }: { locationId: string; enabled?: boolean }) {
  const caps = useLocationCapabilities(locationId)
  if (!caps.data?.canEditCanonical) return null
  return <IndustryResource locationId={locationId} caps={caps.data} enabled={enabled} />
}

function IndustryResource({ locationId, caps, enabled }: {
  locationId: string; caps: LocationCapabilities; enabled: boolean
}) {
  const query = useIndustry(locationId, { enabled })
  useEffect(() => {
    if (enabled) void loadIndustryEditor()
  }, [enabled])
  if (!enabled || query.isPending) return null
  if (query.isError) return <TabError error={query.error} onRetry={() => void query.refetch()} />
  const { disabled, editReason, publishReason } = tabGateReasons(caps, "industry", query.data.writesEnabled ?? true)
  if (query.data.lodging.data == null && !query.data.lodging.error) return null
  return <IndustryEditor locationId={locationId} state={query.data} disabled={disabled} publishReason={editReason ?? publishReason} />
}
