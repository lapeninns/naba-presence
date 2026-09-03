"use client"

import * as React from "react"

import type { Crumb } from "@/components/ui/breadcrumb"

type BreadcrumbsValue = {
  crumbs: Crumb[]
  setCrumbs: (crumbs: Crumb[]) => void
}

const BreadcrumbsContext = React.createContext<BreadcrumbsValue | null>(null)

/**
 * The topbar renders breadcrumbs; the pages know what they are.
 *
 * A context rather than a prop chain because the trail is assembled from
 * several layers — the client layout knows the client, the location workspace
 * knows the location, the tab knows the section — and threading a prop through
 * each of them would make every intermediate layout a client component.
 */
function BreadcrumbsProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([])
  const value = React.useMemo(() => ({ crumbs, setCrumbs }), [crumbs])
  return (
    <BreadcrumbsContext.Provider value={value}>
      {children}
    </BreadcrumbsContext.Provider>
  )
}

function useBreadcrumbs() {
  return React.useContext(BreadcrumbsContext)?.crumbs ?? []
}

/**
 * Declares this page's trail. Clears on unmount so a page that sets no trail
 * never inherits the previous page's.
 */
function useSetBreadcrumbs(crumbs: Crumb[]) {
  const context = React.useContext(BreadcrumbsContext)
  const setCrumbs = context?.setCrumbs
  // Serialised so an inline array literal does not re-fire the effect on
  // every render.
  const serialised = JSON.stringify(crumbs)
  React.useEffect(() => {
    if (!setCrumbs) return
    setCrumbs(JSON.parse(serialised) as Crumb[])
    return () => setCrumbs([])
  }, [serialised, setCrumbs])
}

export { BreadcrumbsProvider, useBreadcrumbs, useSetBreadcrumbs }
