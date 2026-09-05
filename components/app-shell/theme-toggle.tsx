"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ThemeSetting = "light" | "dark" | "system"

const NEXT_THEME: Record<ThemeSetting, ThemeSetting> = {
  light: "dark",
  dark: "system",
  system: "light",
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

/**
 * The three glyphs are stacked and only one is at rest; the others are turned
 * a quarter and shrunk away, so a change of theme reads as the sun turning
 * into the moon rather than one icon blinking into another. The spring curve
 * gives the turn its settle; reduced motion collapses it globally.
 */
const GLYPH_CLASS =
  "absolute size-4 transition duration-(--np-duration-standard) ease-spring"
const GLYPH_AT_REST = "rotate-0 scale-100 opacity-100"
const GLYPH_AWAY = "scale-50 opacity-0"

// One button, three states, no keyboard shortcut. The button itself always
// renders so the header's layout never shifts; only the icon and label swap
// once hydration confirms the real persisted theme.
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()

  const current: ThemeSetting =
    hydrated && isThemeSetting(theme) ? theme : "system"
  const next = NEXT_THEME[current]

  return (
    <Button
      variant="secondary"
      size="icon"
      className="relative rounded-(--np-radius-pill)"
      aria-label={`Theme: ${current}, switch to ${next}`}
      onClick={() => setTheme(next)}
    >
      <Sun
        className={cn(
          GLYPH_CLASS,
          current === "light" ? GLYPH_AT_REST : cn(GLYPH_AWAY, "-rotate-90")
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      <Moon
        className={cn(
          GLYPH_CLASS,
          current === "dark" ? GLYPH_AT_REST : cn(GLYPH_AWAY, "rotate-90")
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      <Monitor
        className={cn(
          GLYPH_CLASS,
          current === "system" ? GLYPH_AT_REST : cn(GLYPH_AWAY, "rotate-90")
        )}
        strokeWidth={1.75}
        aria-hidden
      />
    </Button>
  )
}

export { ThemeToggle }
