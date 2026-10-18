"use client"

import {
  BellIcon,
  CalendarClockIcon,
  CalendarIcon,
  PaletteIcon,
  StarIcon,
  SunriseIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  OptionRow,
  OptionRowGroup,
  OptionSeparator,
} from "@/components/ui/option-row"
import {
  SettingsDestructiveAction,
  SettingsGroup,
  SettingsGroupAction,
  SettingsRow,
} from "@/components/ui/settings-row"
import {
  Sheet,
  SheetBack,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { TypedConfirmation } from "@/components/ui/typed-confirmation"
import { formatShortDate } from "@/lib/format"

/** The demo venue's timezone: presets resolve in venue time, not the browser's. */
const VENUE_TIME_ZONE = "Europe/London"

/**
 * "Wed 15 Oct, 09:00 · venue time" for a preset `days` after today (or the
 * next Monday), at 09:00 in the venue's timezone. Only rendered inside the
 * open sheet, so it runs on the client and cannot mismatch hydration.
 */
function presetLabel(preset: "tomorrow" | "monday"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VENUE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date())
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  const today = new Date(Date.UTC(part("year"), part("month") - 1, part("day")))
  const weekday = today.getUTCDay()
  const days = preset === "tomorrow" ? 1 : (8 - weekday) % 7 || 7
  const day = new Date(today.getTime() + days * 86_400_000)
  const date = formatShortDate(day, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
  })
  return `${date.replace(/,/g, "")}, 09:00 · venue time`
}

const TIMES = ["09:00", "12:00", "17:00"] as const

function ReminderSheet() {
  const [open, setOpen] = React.useState(false)
  const [page, setPage] = React.useState<"root" | "custom">("root")
  const [preset, setPreset] = React.useState<string | null>("tomorrow")
  const [onlyUnanswered, setOnlyUnanswered] = React.useState(true)
  const [time, setTime] = React.useState<string>("09:00")

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setPage("root")
      }}
    >
      <SheetTrigger render={<Button variant="secondary" />}>
        <CalendarClockIcon aria-hidden="true" />
        Set reminder
      </SheetTrigger>
      <SheetContent variant="inset">
        {page === "root" ? (
          <SheetHeader page={page}>
            <SheetTitle>Set reminder</SheetTitle>
          </SheetHeader>
        ) : (
          <SheetHeader
            page={page}
            back={
              <SheetBack to="Set reminder" onClick={() => setPage("root")} />
            }
            action={
              <Button
                size="sm"
                onClick={() => {
                  setPreset(`custom ${time}`)
                  setOpen(false)
                  setPage("root")
                }}
              >
                Schedule
              </Button>
            }
          >
            <SheetTitle>Custom date</SheetTitle>
          </SheetHeader>
        )}
        <SheetBody>
          {page === "root" ? (
            <>
              <OptionRowGroup label="Remind me">
                <OptionRow
                  indicator="radio"
                  icon={<SunriseIcon />}
                  label="Tomorrow"
                  description={presetLabel("tomorrow")}
                  selected={preset === "tomorrow"}
                  onClick={() => setPreset("tomorrow")}
                />
                <OptionRow
                  indicator="radio"
                  icon={<CalendarIcon />}
                  label="Next Monday"
                  description={presetLabel("monday")}
                  selected={preset === "monday"}
                  onClick={() => setPreset("monday")}
                />
              </OptionRowGroup>
              <OptionRow
                indicator="chevron"
                icon={<CalendarClockIcon />}
                label="Custom date"
                description="Pick a date and time"
                onClick={() => setPage("custom")}
              />
              <OptionRow
                indicator="checkbox"
                label="Only if still unanswered"
                selected={onlyUnanswered}
                onClick={() => setOnlyUnanswered((v) => !v)}
              />
              <OptionSeparator />
              <OptionRow
                tone="destructive"
                icon={<Trash2Icon />}
                label="Remove reminder"
                onClick={() => {
                  setPreset(null)
                  setOpen(false)
                }}
              />
            </>
          ) : (
            <OptionRowGroup label="Time, venue time">
              {TIMES.map((t) => (
                <OptionRow
                  key={t}
                  indicator="check"
                  label={t}
                  description="Europe/London"
                  selected={time === t}
                  onClick={() => setTime(t)}
                />
              ))}
            </OptionRowGroup>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function SettingsDemo() {
  const [prefs, setPrefs] = React.useState({
    newReview: true,
    lowRating: false,
    approval: false,
  })
  const [confirming, setConfirming] = React.useState(false)
  const [matched, setMatched] = React.useState(false)
  const allOn = Object.values(prefs).every(Boolean)

  return (
    <div className="max-w-md">
      <SettingsGroup label="Preferences" as="h3">
        <SettingsRow
          icon={<PaletteIcon />}
          label="Appearance"
          value="System"
          onClick={() => {}}
        />
        <SettingsRow
          icon={<CalendarIcon />}
          label="Timezone"
          value="Europe/London"
        />
      </SettingsGroup>
      <SettingsGroup
        label="Notifications per event"
        as="h3"
        card
        action={
          <SettingsGroupAction
            onClick={() =>
              setPrefs({
                newReview: !allOn,
                lowRating: !allOn,
                approval: !allOn,
              })
            }
          >
            {allOn ? "Turn all off" : "Turn all on"}
          </SettingsGroupAction>
        }
      >
        <SettingsRow
          icon={<StarIcon />}
          label="New review"
          description="Every new review at your venues"
          checked={prefs.newReview}
          onCheckedChange={(v) => setPrefs((p) => ({ ...p, newReview: v }))}
        />
        <SettingsRow
          icon={<BellIcon />}
          label="Low rating"
          description="One or two stars, as soon as they sync"
          checked={prefs.lowRating}
          onCheckedChange={(v) => setPrefs((p) => ({ ...p, lowRating: v }))}
        />
        <SettingsRow
          icon={<BellIcon />}
          label="Approval needed"
          checked={prefs.approval}
          onCheckedChange={(v) => setPrefs((p) => ({ ...p, approval: v }))}
        />
      </SettingsGroup>
      <SettingsDestructiveAction onClick={() => setConfirming(true)}>
        Disconnect Google account
      </SettingsDestructiveAction>
      {/* Removal always goes through TypedConfirmation, never a plain alert. */}
      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          setConfirming(next)
          if (!next) setMatched(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Google account?</DialogTitle>
            <DialogDescription>
              Reviews and listings stop syncing for every venue on this account.
              Nothing is deleted on Google.
            </DialogDescription>
          </DialogHeader>
          <TypedConfirmation
            expected="The Old Crown"
            onMatchChange={setMatched}
          />
          <DialogFooter>
            <Button
              variant="danger"
              disabled={!matched}
              onClick={() => setConfirming(false)}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * A left-aligned header with a description long enough to wrap: the close
 * keeps its own column instead of drawing over the words (FINAL-QA #4).
 */
function ScopeSheetDemo() {
  const [client, setClient] = React.useState("all")
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="secondary" />}>
        Choose a client
      </SheetTrigger>
      <SheetContent variant="inset">
        <SheetHeader>
          <SheetTitle>Choose a client</SheetTitle>
          <SheetDescription>
            Reviews, listings and reports on this screen show this client. You
            can change it again as you make them.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <OptionRowGroup label="Client">
            {[
              { id: "all", label: "All clients" },
              { id: "harbour", label: "Harbour Collective" },
            ].map((option) => (
              <OptionRow
                key={option.id}
                indicator="radio"
                label={option.label}
                selected={client === option.id}
                onClick={() => setClient(option.id)}
              />
            ))}
          </OptionRowGroup>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

/**
 * The Notion Mail sheet and settings primitives: an inset sheet of option
 * rows with an in-sheet push, settings groups and rows, and neutral
 * avatars at every size.
 */
export function NmSheetDemo() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-ui text-ink-muted">
          Inset sheet: presets resolve in venue time; choices apply at once, the
          pushed page confirms with its one header action.
        </p>
        <div className="flex flex-wrap gap-2">
          <ReminderSheet />
          <ScopeSheetDemo />
        </div>
      </div>
      <SettingsDemo />
      <div className="flex flex-wrap items-end gap-4">
        <Avatar size="sm">
          <AvatarFallback>OC</AvatarFallback>
        </Avatar>
        <Avatar size="md">
          <AvatarFallback>OC</AvatarFallback>
        </Avatar>
        <Avatar size="list">
          <AvatarFallback>OC</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>OC</AvatarFallback>
        </Avatar>
        <Avatar size="xl" ring>
          <AvatarFallback>OC</AvatarFallback>
        </Avatar>
        <Avatar size="list" shape="square" ring>
          <AvatarFallback>TB</AvatarFallback>
        </Avatar>
      </div>
    </div>
  )
}
