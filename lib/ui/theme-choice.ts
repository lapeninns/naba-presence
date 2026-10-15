"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { useHydrated } from "@/lib/hooks/use-hydrated"

/**
 * The three themes, in one order everywhere: the desk account menu, the
 * More sheet's segmented control (which has room only for `short`) and the
 * settings index's Appearance sheet.
 */
export const THEME_CHOICES = [
  { value: "light", label: "Light", short: "Light", icon: Sun },
  { value: "dark", label: "Dark", short: "Dark", icon: Moon },
  { value: "system", label: "Match system", short: "System", icon: Monitor },
] as const

/**
 * The chosen theme and the way to change it. Before hydration the stored
 * choice is unknown, so it reads "system" (what the first paint follows)
 * rather than flashing a different selection.
 */
export function useThemeChoice() {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  return {
    theme: hydrated && theme ? theme : "system",
    setTheme: (value: string) => setTheme(value),
  }
}
