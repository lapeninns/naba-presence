"use client"

import { useCommandState } from "cmdk"

import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import type { ClientSummary } from "@/lib/contracts/clients"

import {
  AllClientsOption,
  ClientOption,
  CurrentMark,
} from "./client-scope-rows"

/**
 * The desk switcher's searchable list, for more than eight clients.
 *
 * Loaded lazily by client-switcher.tsx (only when the popover first opens,
 * or warmed when the pointer reaches the trigger): it is the one part of the
 * switcher built on cmdk, and cmdk with its dialog stack has no business in
 * every route's first JavaScript for a list most sessions never open.
 */

const ALL = "__all__"

/**
 * The no-match line, drawn as a disabled option: cmdk's own Empty renders
 * with role="presentation", which leaves the listbox with no option child
 * at all while a search matches nothing (axe aria-required-children). Not a
 * cmdk item, so the keyboard navigation never lands on it.
 */
function NoMatch() {
  const empty = useCommandState(
    (state) => state.search.trim().length > 0 && state.filtered.count === 0
  )
  if (!empty) return null
  return (
    <div
      role="option"
      aria-disabled="true"
      aria-selected={false}
      data-slot="command-empty"
      className="px-4 py-8 text-center text-ui text-ink-muted"
    >
      No client matches that.
    </div>
  )
}

function ClientSearchList({
  clients,
  current,
  onChoose,
}: {
  clients: ClientSummary[]
  current: string | null
  onChoose: (clientId: string | null) => void
}) {
  return (
    // cmdk names the field and the list from `label`. The filter matches
    // names only: an item's value is its id, which would otherwise match any
    // search that happens to be hex.
    <Command
      label="Search clients"
      filter={(_value, search, keywords) =>
        (keywords ?? []).some((keyword) =>
          keyword.toLowerCase().includes(search.trim().toLowerCase())
        )
          ? 1
          : 0
      }
      className="rounded-(--np-radius-card)"
    >
      {/* `text-body`, not `text-ui`: a field under 16px makes iOS zoom the
          page on focus. autoFocus because the list arrives after the popover
          has opened and placed focus, so the field has to claim it. */}
      <CommandInput
        placeholder="Search clients"
        className="h-11 text-body"
        autoFocus
      />
      <CommandList className="max-h-[min(50vh,--spacing(96))]">
        <NoMatch />
        <CommandItem
          value={ALL}
          keywords={["All clients"]}
          aria-current={current === null ? "true" : undefined}
          onSelect={() => onChoose(null)}
        >
          <AllClientsOption />
          <CurrentMark current={current === null} />
        </CommandItem>
        <CommandSeparator />
        {clients.map((entry) => (
          <CommandItem
            key={entry.id}
            value={entry.id}
            keywords={[entry.name]}
            aria-current={entry.id === current ? "true" : undefined}
            onSelect={() => onChoose(entry.id)}
          >
            <ClientOption client={entry} />
            <CurrentMark current={entry.id === current} />
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}

export { ClientSearchList }
