"use client"

import { buttonVariants } from "@/components/ui/button"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { SectionCard } from "../section-card"

export function ProductCatalogueHandoff({ locationId }: { readonly locationId: string }) {
  const caps = useLocationCapabilities(locationId).data
  const action = caps?.resourceActions?.actions["retailProducts.manage"]
  if (!caps?.canEditCanonical || action?.support !== "external" || !action.handoffUrl) return null
  return <SectionCard id="section-retail-products" title="Product catalogue" description="Manage retail products directly in Google Business Profile.">
    <p className="text-ui text-ink-muted">Retail products do not use the food-menu editor. This catalogue is managed in Google.</p>
    <a className={buttonVariants({ variant: "secondary" })} href={action.handoffUrl} target="_blank" rel="noopener noreferrer">Manage retail products in Google</a>
  </SectionCard>
}
