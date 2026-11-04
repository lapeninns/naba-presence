"use client"

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import * as React from "react"

import { themeColorFor, type ResolvedTheme } from "@/lib/ui/theme-color"

/**
 * next-themes writes the class on <html> from an inline script before the
 * first paint (no flash). `disableTransitionOnChange` matters for a switch
 * mid-session: every control animates its colours over 140ms, so without it
 * the page repaints in a ripple of half-switched surfaces.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  )
}

/**
 * The viewport's theme-color metas follow `prefers-color-scheme`, so a
 * person who picks Dark on a light system would keep a light browser bar
 * over a dark page. This points both metas at the chosen theme, and back at
 * their own media when the choice is "Match system".
 */
function ThemeColorSync() {
  const { theme, resolvedTheme } = useTheme()
  const forced: ResolvedTheme | null =
    theme === "light" || theme === "dark" ? theme : null
  React.useEffect(() => {
    for (const meta of document.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]'
    )) {
      meta.content = themeColorFor(meta.getAttribute("media"), forced)
    }
  }, [forced, resolvedTheme])
  return null
}
