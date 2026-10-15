"use client"

import { Monitor, Moon, Sun, SunMoon } from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { SettingsRow } from "@/components/ui/settings-row"
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

/**
 * The settings index's Appearance row (SET-26): people look for the theme
 * in Settings, so it is there as well as in More. The row shows the current
 * choice and opens a titled sheet of the three; choosing one applies it and
 * closes the sheet. The theme is kept in this browser only, which the "You"
 * group's footer already says of everything in it.
 */
export function AppearanceRow({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false)
  const { theme, setTheme } = useThemeChoice()
  const current =
    THEME_CHOICES.find((choice) => choice.value === theme) ?? THEME_CHOICES[2]
  return (
    <>
      <SettingsRow
        icon={<SunMoon />}
        label="Appearance"
        description="Light, dark or the same as this device"
        value={current.label}
        onClick={() => setOpen(true)}
        className={className}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>Appearance</DialogTitle>
            <DialogDescription>
              Applies to this browser on this device.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <OptionRowGroup label="Theme">
              {THEME_CHOICES.map((choice) => (
                <OptionRow
                  key={choice.value}
                  indicator="radio"
                  selected={choice.value === current.value}
                  label={choice.label}
                  onClick={() => {
                    setTheme(choice.value)
                    setOpen(false)
                  }}
                />
              ))}
            </OptionRowGroup>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
