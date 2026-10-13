"use client"

import { StoreIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The clients page's "All listings" header link.
 *
 * A client module on purpose: Next merges the `/clients` page's client
 * reference manifest into its child routes' (`/clients/new`, ...), so a
 * direct `next/link`, lucide or Base UI reference from the server page
 * resolved to the `/clients` page chunks there and pulled the clients index
 * into those routes. See `components/listings/add-listings-link.tsx`.
 */
export function AllListingsLink() {
  return (
    <Link
      href="/listings"
      className={cn(buttonVariants({ variant: "secondary" }))}
    >
      <StoreIcon aria-hidden strokeWidth={1.75} />
      All listings
    </Link>
  )
}
