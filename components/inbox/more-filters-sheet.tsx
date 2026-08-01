"use client"

import { useId, useState } from "react"
import { SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { InboxState } from "@/lib/inbox/url-state"

const VERIFICATION = [
  { value: "pass", label: "Passed" },
  { value: "warn", label: "Review needed" },
  { value: "fail", label: "Failed" },
  { value: "pending", label: "Pending" },
]
// Publish/sync status share a few labels with verification and with each
// other ("Failed", "Pending"). Three checkboxes with the identical accessible
// name "Failed" would be ambiguous to screen readers (and to
// `getByRole("checkbox", { name: "Failed" })` — see the pinned test, which
// expects exactly one). `ariaLabel` disambiguates every non-verification
// entry that would otherwise collide, while the verification group keeps its
// plain label as the sole "Failed"/"Pending" accessible name.
const PUBLISH_STATUS = [
  { value: "not_published", label: "Not published" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "accepted", label: "Accepted" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed", ariaLabel: "Publish status: Failed" },
  { value: "deleted", label: "Deleted" },
]
const SYNC_STATUS = [
  { value: "pending", label: "Pending", ariaLabel: "Sync status: Pending" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed", ariaLabel: "Sync status: Failed" },
  { value: "cancelled", label: "Cancelled" },
]

function toggle(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function CheckboxGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string
  options: { value: string; label: string; ariaLabel?: string }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ui font-medium">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-ui">
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            aria-label={option.ariaLabel ?? option.label}
            onChange={() => onToggle(option.value)}
            className="size-4 accent-primary"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}

function MoreFiltersSheet({
  state,
  onChange,
}: {
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
}) {
  const [open, setOpen] = useState(false)
  const dateFromId = useId()
  const dateToId = useId()
  const activeCount =
    (state.verification.length ? 1 : 0) +
    (state.publishStatus.length ? 1 : 0) +
    (state.syncStatus.length ? 1 : 0) +
    (state.replyState ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0)

  function toIso(dateValue: string): string | undefined {
    if (!dateValue) return undefined
    return new Date(`${dateValue}T00:00:00.000Z`).toISOString()
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontalIcon aria-hidden />
        More filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </SheetTrigger>
      <SheetContent side="right" className="data-[side=right]:w-80">
        <SheetHeader>
          <SheetTitle>More filters</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto p-6">
          <CheckboxGroup
            legend="Verification"
            options={VERIFICATION}
            selected={state.verification}
            onToggle={(value) =>
              onChange({ verification: toggle(state.verification, value) })
            }
          />
          <CheckboxGroup
            legend="Publish status"
            options={PUBLISH_STATUS}
            selected={state.publishStatus}
            onToggle={(value) =>
              onChange({ publishStatus: toggle(state.publishStatus, value) })
            }
          />
          <CheckboxGroup
            legend="Sync status"
            options={SYNC_STATUS}
            selected={state.syncStatus}
            onToggle={(value) =>
              onChange({ syncStatus: toggle(state.syncStatus, value) })
            }
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ui font-medium">Reply state</legend>
            {[
              { value: "", label: "Any" },
              { value: "unreplied", label: "Not replied" },
              { value: "replied", label: "Replied" },
            ].map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-ui">
                <input
                  type="radio"
                  name="replyState"
                  checked={(state.replyState ?? "") === option.value}
                  aria-label={option.label}
                  onChange={() =>
                    onChange({
                      replyState:
                        option.value === ""
                          ? undefined
                          : (option.value as "replied" | "unreplied"),
                    })
                  }
                  className="size-4 accent-primary"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor={dateFromId} className="text-ui font-medium">
              From date
            </label>
            <input
              id={dateFromId}
              type="date"
              aria-label="From date"
              value={state.dateFrom ? state.dateFrom.slice(0, 10) : ""}
              onChange={(event) => onChange({ dateFrom: toIso(event.target.value) })}
              className="h-8 rounded-(--nr-radius-control) border border-border bg-card px-3 text-ui"
            />
            <label htmlFor={dateToId} className="text-ui font-medium">
              To date
            </label>
            <input
              id={dateToId}
              type="date"
              aria-label="To date"
              value={state.dateTo ? state.dateTo.slice(0, 10) : ""}
              onChange={(event) => onChange({ dateTo: toIso(event.target.value) })}
              className="h-8 rounded-(--nr-radius-control) border border-border bg-card px-3 text-ui"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { MoreFiltersSheet }
