"use client"

import { PlusIcon } from "lucide-react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The "Add listings from Google" action, at the end of the listings board
 * (owners and admins only; the board decides who sees it).
 *
 * A client module on purpose. Next merges a parent route's client reference
 * manifest into every child route's (`/listings` into `/listings/[id]/*` and
 * `/listings/bulk/*`). When the listings page server component referenced
 * `next/link`, lucide's `Icon` and Base UI's `Button` directly, those shared
 * references resolved to the `/listings` page chunks on every child route, so
 * each listing page downloaded the listings board. Wrapping them here keeps
 * the page's only client references to modules no child route renders.
 *
 * Prefetched on intent only: /setup is a heavy page.
 */
export function AddListingsLink() {
  return (
    <ShellLink href="/setup" className={cn(buttonVariants())}>
      <PlusIcon aria-hidden strokeWidth={1.75} />
      Add listings from Google
    </ShellLink>
  )
}
