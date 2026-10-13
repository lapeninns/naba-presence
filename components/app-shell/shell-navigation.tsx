"use client"

import { createContext, useContext } from "react"

import type { NavigationContext } from "@/lib/navigation/destinations"

/**
 * The navigation context the shell filters destinations by (role, mode and
 * the `post_scheduling` flag), for pages inside the shell that list
 * destinations themselves: the dashboard 404's "Where to go instead". A
 * module of its own so such a page doesn't pull the whole shell into its
 * chunk. Null outside the shell.
 */
const ShellNavigationContext = createContext<NavigationContext | null>(null)

function useShellNavigation(): NavigationContext | null {
  return useContext(ShellNavigationContext)
}

export { ShellNavigationContext, useShellNavigation }
