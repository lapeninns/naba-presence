"use client"

import { PlusIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The listings page's "Add listings from Google" header action.
 *
 * A client module on purpose. Next merges a parent route's client reference
 * manifest into every child route's (`/listings` into `/listings/[id]/*` and
 * `/listings/bulk/*`). When the listings page server component referenced
 * `next/link`, lucide's `Icon` and Base UI's `Button` directly, those shared
 * references resolved to the `/listings` page chunks on every child route, so
 * each listing page downloaded the listings board. Wrapping them here keeps
 * the page's only client references to modules no child route renders.
 */
export function AddListingsLink() {
  return (
    <Link href="/setup" className={cn(buttonVariants())}>
      <PlusIcon aria-hidden strokeWidth={1.75} />
      Add listings from Google
    </Link>
  )
}
