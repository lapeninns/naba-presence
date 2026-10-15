"use client"

import { PlusIcon } from "lucide-react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The "Add listings from Google" action, shown to owners and admins at the
 * end of the listings board (loading, loaded and error states; the board
 * decides who sees it).
 *
 * A client module so the listings page's server component never references
 * `next/link`, lucide or the button directly: Next merges a parent route's
 * client reference manifest into every child route's, which once made each
 * listing page download the board.
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
