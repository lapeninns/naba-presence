"use client"

import { useId, useState, type ReactNode } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { ChoiceCard } from "@/components/ui/choice-card"
import { Input } from "@/components/ui/input"
import { QueryStates, type QueryStatus } from "@/components/ui/query-states"
import { RadioGroup } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/** Above this many items the checklist gets a search box. */
export const ACCESS_SEARCH_THRESHOLD = 8

/** "Ben" from "Ben Member", for sentences about one teammate. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

export type AccessScopeMode = "all" | "some"

/** One row of the "Only these" checklist. */
export type AccessScopeItem = {
  id: string
  /** The plain name: searched, and used in the publish switch's name. */
  name: string
  /** The visible label when it differs from `name` ("Old Crown (archived)"). */
  label?: string
  description?: string
  checked: boolean
  indeterminate?: boolean
  disabled?: boolean
  /** A control beside the row ("Give all 5"). */
  action?: ReactNode
  /** A per-row "Can publish" switch; left out, the row has none. */
  publish?: { checked: boolean; label: string }
}

/**
 * Who sees what: "All {noun}, including ones added later" or "Only these
 * {noun}", then a checklist of the ones to tick (searchable past eight),
 * with an optional per-row publish switch. Shared by Client access and
 * Location access on a Team row, and the invite form's client choice.
 *
 * The form holds no access state of its own (only the search text): each
 * caller keeps its own picks and builds its own payload, because the three
 * save different things (client grants that may stay "unchanged", location
 * grants, an invitation's client ids). The list is never a nested scroll
 * region: the dialog or sheet around it scrolls.
 */
export function AccessScopeForm({
  noun,
  legend,
  legendVisible = false,
  mode,
  onModeChange,
  allOption,
  someOption,
  split = false,
  items,
  itemsStatus = "ready",
  itemsError,
  onRetryItems,
  emptyMessage,
  onToggle,
  onPublishChange,
  disabled = false,
  error,
  note,
}: {
  /** The scope noun: `{ one: "client", many: "clients" }`. */
  noun: { one: string; many: string }
  /** Names the All / Only these choice. */
  legend: string
  /** Show the legend as a label; otherwise it is for assistive tech only. */
  legendVisible?: boolean
  mode: AccessScopeMode
  onModeChange: (mode: AccessScopeMode) => void
  allOption: { title: string; description: ReactNode }
  someOption: { title: string; description: ReactNode }
  /** Lay the two choices side by side when the container has room. */
  split?: boolean
  items: AccessScopeItem[]
  /** The state of the query behind `items`, when they load separately. */
  itemsStatus?: QueryStatus
  itemsError?: unknown
  onRetryItems?: () => void
  /** Shown instead of the list when there is nothing to tick. */
  emptyMessage: ReactNode
  onToggle: (id: string, checked: boolean) => void
  onPublishChange?: (id: string, value: boolean) => void
  disabled?: boolean
  /** A refusal about the selection ("Tick at least one client…"). */
  error?: string | null
  /** A line under the checklist (only while "Only these" is chosen). */
  note?: ReactNode
}) {
  const ids = useId()
  const [search, setSearch] = useState("")
  const legendId = `${ids}-legend`
  const listLabelId = `${ids}-list`
  const errorId = `${ids}-error`
  const listTitle = noun.many.charAt(0).toUpperCase() + noun.many.slice(1)

  const needle = search.trim().toLowerCase()
  const visible = needle
    ? items.filter((item) => item.name.toLowerCase().includes(needle))
    : items

  return (
    <div className="@container/scope flex min-w-0 flex-col gap-2">
      <span
        id={legendId}
        className={legendVisible ? "text-ui font-semibold text-ink" : "sr-only"}
      >
        {legend}
      </span>
      <RadioGroup
        value={mode}
        onValueChange={(next) => onModeChange(next as AccessScopeMode)}
        aria-labelledby={legendId}
        disabled={disabled}
        className={cn(
          "grid grid-cols-1 gap-2",
          split && "@[30rem]/scope:grid-cols-2"
        )}
      >
        <ChoiceCard
          value="all"
          title={allOption.title}
          description={allOption.description}
        />
        <ChoiceCard
          value="some"
          title={someOption.title}
          description={someOption.description}
        />
      </RadioGroup>

      {mode === "some" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <span id={listLabelId} className="text-ui font-semibold text-ink">
            {listTitle}
          </span>
          <QueryStates
            status={
              itemsStatus === "ready" && items.length === 0
                ? "empty"
                : itemsStatus
            }
            pending={<Skeleton className="h-16 w-full" />}
            error={{
              title: `We couldn’t load your ${noun.many}`,
              cause: itemsError,
            }}
            onRetry={onRetryItems}
            empty={<p className="text-ui text-ink-muted">{emptyMessage}</p>}
          >
            {items.length > ACCESS_SEARCH_THRESHOLD ? (
              <Input
                type="search"
                aria-label={`Search ${noun.many}`}
                placeholder={`Search ${noun.many}`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onClear={() => setSearch("")}
              />
            ) : null}
            <ul
              aria-labelledby={listLabelId}
              aria-describedby={error ? errorId : undefined}
              className="flex min-w-0 flex-col divide-y divide-line rounded-(--np-radius-card) border border-line"
            >
              {visible.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1 desk:py-2.5"
                >
                  <Checkbox
                    checked={item.checked}
                    indeterminate={item.indeterminate}
                    disabled={disabled || item.disabled}
                    label={item.label ?? item.name}
                    description={item.description}
                    labelClassName="min-w-0 flex-1 basis-48"
                    onCheckedChange={(checked) => onToggle(item.id, checked)}
                  />
                  {item.action || item.publish ? (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {item.action}
                      {item.publish ? (
                        <span className="flex min-h-(--np-touch) items-center gap-2 text-ui text-ink-secondary desk:min-h-8">
                          {item.publish.label}
                          <Switch
                            checked={item.publish.checked}
                            disabled={disabled}
                            aria-label={`Can publish to ${item.name}`}
                            onCheckedChange={(value) =>
                              onPublishChange?.(item.id, value)
                            }
                          />
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
              {visible.length === 0 ? (
                <li className="px-3 py-2.5 text-ui text-ink-muted">
                  No {noun.many} match “{search}”.
                </li>
              ) : null}
            </ul>
          </QueryStates>
          {error ? (
            <p id={errorId} role="alert" className="text-ui text-danger-ink">
              {error}
            </p>
          ) : null}
          {note ? <p className="text-ui text-ink-muted">{note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
