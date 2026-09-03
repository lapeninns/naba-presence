"use client"

import { usePathname } from "next/navigation"

import { Breadcrumbs } from "@/components/ui/breadcrumb"
import { breadcrumbTrail } from "@/lib/ui/breadcrumb-trail"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

/**
 * The topbar's trail, derived from the path and the lists the shell already
 * holds.
 *
 * Deliberately NOT pushed up from each page: pages sit behind their own client
 * boundaries, so a context written deep in the tree and read here arrives a
 * render late at best, and not at all across some boundaries. Reading the URL
 * is the one source that is always right and always available.
 */
function ShellBreadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname()
  const clients = useClients()
  const locations = useLocationDirectory(useSessionRole())

  const crumbs = breadcrumbTrail({
    pathname: pathname ?? "",
    clients: clients.data?.items ?? [],
    locations: locations.data ?? [],
  })

  return <Breadcrumbs crumbs={crumbs} className={className} />
}

export { ShellBreadcrumbs }
