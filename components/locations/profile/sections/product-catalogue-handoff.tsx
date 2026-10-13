"use client"

import { ExternalLinkIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { SectionCard } from "../section-card"

/** The catalogue handoff's jump target in the profile's section navigation. */
export const PRODUCT_CATALOGUE_ID = "section-retail-products"

export function ProductCatalogueHandoff({ locationId }: { readonly locationId: string }) {
  const caps = useLocationCapabilities(locationId).data
  const action = caps?.resourceActions?.actions["retailProducts.manage"]
  if (!caps?.canEditCanonical || action?.support !== "external" || !action.handoffUrl) return null
  return <SectionCard id={PRODUCT_CATALOGUE_ID} title="Product catalogue" description="Manage retail products directly in Google Business Profile.">
    <div className="flex min-h-(--np-row-h) flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="min-w-0 grow basis-48 text-caption text-ink-muted">Retail products do not use the food-menu editor. This catalogue is managed in Google.</p>
      <a className={buttonVariants({ variant: "secondary" })} href={action.handoffUrl} target="_blank" rel="noopener noreferrer">Manage retail products in Google<ExternalLinkIcon aria-hidden /></a>
    </div>
  </SectionCard>
}
