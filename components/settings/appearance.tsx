"use client"

import { SunMoon } from "lucide-react"
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
import { THEME_CHOICES, useThemeChoice } from "@/lib/ui/theme-choice"

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
