"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"

type ThemeSetting = "light" | "dark" | "system"

const NEXT_THEME: Record<ThemeSetting, ThemeSetting> = {
  light: "dark",
  dark: "system",
  system: "light",
}

const THEME_ICON: Record<ThemeSetting, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

function isThemeSetting(value: string | undefined): value is ThemeSetting {
  return value === "light" || value === "dark" || value === "system"
}

const subscribeNever = () => () => {}

// `theme` reflects localStorage synchronously on the client but not during
// the server render, so reading it before hydration completes would
// mismatch. `useSyncExternalStore`'s server/client snapshot split is the
// React-recommended way to gate on "has hydration finished" without the
// setState-in-effect render cascade a `useEffect(() => setMounted(true))`
// guard would cause: `getServerSnapshot` (false) is what both the server
// render and the client's hydration-matching first render use, and React
// re-renders with the real `getSnapshot` (true) right after.
function useHydrated() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
}

// One button, three states, no keyboard shortcut. The button itself always
// renders so the header's layout never shifts; only the icon and label swap
// once hydration confirms the real persisted theme.
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()

  const current: ThemeSetting =
    hydrated && isThemeSetting(theme) ? theme : "system"
  const next = NEXT_THEME[current]
  const Icon = THEME_ICON[current]

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Theme: ${current}, switch to ${next}`}
      onClick={() => setTheme(next)}
    >
      <Icon aria-hidden />
    </Button>
  )
}

export { ThemeToggle }
