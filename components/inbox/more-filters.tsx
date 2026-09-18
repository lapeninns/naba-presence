"use client"

import { useId } from "react"

import { ReplyFilter } from "@/components/inbox/filter-controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

function Group({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 border-t border-line-subtle py-4 first:border-t-0 first:pt-0",
        className
      )}
    >
      <h3 className="text-ui font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

/**
 * Everything the toolbar does not keep on screen: client scope, reply status
 * and a custom date range.
 *
 * A temporary panel rather than a permanent column, and deliberately short.
 * The verification / publish / sync checkbox groups that used to sit here
 * filtered on pipeline state — an engineer's view of a record, not a question
 * an operator asks — and the saved presets duplicated controls already on the
 * toolbar. Both are gone; what is left is the handful of narrowings that have
 * no home on the one-line toolbar. Below `md` the Sheet primitive turns this
 * into a bottom sheet on its own.
 */
function MoreFiltersPanel({
  open,
  onOpenChange,
  state,
  clients,
  onChange,
  onClear,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: InboxState
  /** The agency's clients, for the scope select. Empty for a single-client org. */
  clients: { id: string; name: string }[]
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
}) {
  const dateFromId = useId()
  const dateToId = useId()
  const clientId = useId()
  const clientItems: Record<string, string> = {
    "": "All clients",
    ...Object.fromEntries(clients.map((client) => [client.id, client.name])),
  }

  function toIso(dateValue: string): string | undefined {
    if (!dateValue) return undefined
    return new Date(`${dateValue}T00:00:00.000Z`).toISOString()
  }

  // A typed date is the specific claim, so it clears the Age preset — the
  // mirror of what the Age control does to the dates. See lib/inbox/review-age.ts.
  function setDate(partial: Partial<InboxState>) {
    onChange({ ...partial, age: undefined })
  }

  const rangeInverted = Boolean(
    state.dateFrom && state.dateTo && state.dateFrom > state.dateTo
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="md:max-w-md">
        <SheetHeader>
          <SheetTitle>More filters</SheetTitle>
          <SheetDescription>
            Client scope, reply status and a custom date range.
          </SheetDescription>
        </SheetHeader>

        {/* `px-6` is the sheet gutter SheetHeader draws and every other sheet
            in the app carries. This panel used the narrower card padding, so
            its title sat 8px inside its own controls. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
          {clients.length > 1 ? (
            <Group title="Client scope">
              <Select
                value={state.clientId ?? ""}
                items={clientItems}
                onValueChange={(value: string | null) =>
                  onChange({ clientId: value ? value : undefined })
                }
              >
                <SelectTrigger
                  id={clientId}
                  aria-label="Filter by client"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(clientItems).map(([value, label]) => (
                    <SelectItem key={value || "all"} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Group>
          ) : null}

          <Group title="Reply status">
            <ReplyFilter
              replyState={state.replyState}
              onChange={(replyState) => onChange({ replyState })}
            />
          </Group>

          <Group title="Date range">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={dateFromId}
                  className="px-1 text-caption text-ink-muted"
                >
                  From date
                </label>
                <Input
                  id={dateFromId}
                  type="date"
                  aria-label="From date"
                  aria-invalid={rangeInverted || undefined}
                  value={state.dateFrom ? state.dateFrom.slice(0, 10) : ""}
                  onChange={(event) =>
                    setDate({ dateFrom: toIso(event.target.value) })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={dateToId}
                  className="px-1 text-caption text-ink-muted"
                >
                  To date
                </label>
                <Input
                  id={dateToId}
                  type="date"
                  aria-label="To date"
                  aria-invalid={rangeInverted || undefined}
                  value={state.dateTo ? state.dateTo.slice(0, 10) : ""}
                  onChange={(event) =>
                    setDate({ dateTo: toIso(event.target.value) })
                  }
                />
              </div>
            </div>
            {rangeInverted ? (
              <p role="alert" className="text-caption text-danger-ink">
                The end date must be on or after the start date.
              </p>
            ) : null}
            {state.age ? (
              <p className="text-caption text-ink-muted">
                A date here replaces the Age preset in the toolbar.
              </p>
            ) : null}
          </Group>
        </div>

        {/* SheetFooter, so this panel's action row is the same object as
            every other sheet's rather than a lookalike: it keeps the shared
            stack-then-row geometry and only adds the separator and the
            space-between this one wants. */}
        <SheetFooter className="flex-row items-center justify-between border-t border-line-subtle px-6 py-4 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
          <Button size="sm" pill onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { MoreFiltersPanel }
