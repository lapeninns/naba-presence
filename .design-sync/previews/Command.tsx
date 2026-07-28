import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "NabaReview"
import {
  Building2,
  CornerUpLeft,
  Download,
  Flag,
  MapPin,
  RefreshCw,
  Star,
  Users,
} from "lucide-react"

// `Command` renders inline (only `CommandDialog` portals), so the whole palette
// cards cleanly. `CommandInput` is controllable: passing `value` writes straight
// into cmdk's search state, which is how the empty state below is reached.
//
// `CommandItem` always appends a trailing check that only hides when the row
// carries `data-slot="command-shortcut"` — so a trailing value span needs that
// slot to sit flush right. `CommandShortcut` is the styled version of it; the
// plain spans below skip its `tracking-widest`, which mangles numerals.

export function Palette() {
  return (
    <Command className="w-full max-w-md border border-border shadow-sm">
      <CommandInput placeholder="Jump to a location, review, or action…" />
      <CommandList>
        <CommandEmpty>No matches in this workspace.</CommandEmpty>
        <CommandGroup heading="Locations">
          <CommandItem>
            <Building2 />
            Lapen Inn — Central
            <CommandShortcut className="font-mono">⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Building2 />
            Lapen Inn — Riverside
            <CommandShortcut className="font-mono">⌘2</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Building2 />
            Lapen Inn — Airport
            <CommandShortcut className="font-mono">⌘3</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem>
            <CornerUpLeft />
            Open reply queue
            <CommandShortcut className="font-mono">⌘R</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <RefreshCw />
            Sync from Google now
          </CommandItem>
          <CommandItem>
            <Download />
            Export reviews as CSV
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export function NoResults() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Command className="border border-border shadow-sm">
        <CommandInput value="conference suite" />
        <CommandList>
          <CommandEmpty>
            No location or review matches “conference suite”.
          </CommandEmpty>
          <CommandGroup heading="Locations">
            <CommandItem>
              <Building2 />
              Lapen Inn — Central
            </CommandItem>
            <CommandItem>
              <Building2 />
              Lapen Inn — Riverside
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
      <p className="text-sm text-muted-foreground">
        Always supply <span className="font-mono text-xs">CommandEmpty</span> — a
        palette that filters to nothing otherwise renders a blank box.
      </p>
    </div>
  )
}

export function JumpToReview() {
  return (
    <Command className="w-full max-w-md border border-border shadow-sm">
      <CommandInput placeholder="Search reviews…" />
      <CommandList>
        <CommandEmpty>No reviews match that search.</CommandEmpty>
        <CommandGroup heading="Awaiting reply">
          <CommandItem>
            <Star className="fill-rating text-rating" />
            Priya Sharma · Central
            <span data-slot="command-shortcut" className="ml-auto font-mono text-xs text-muted-foreground">5.0</span>
          </CommandItem>
          <CommandItem>
            <Star className="fill-rating text-rating" />
            Tom Okafor · Riverside
            <span data-slot="command-shortcut" className="ml-auto font-mono text-xs text-muted-foreground">4.0</span>
          </CommandItem>
          <CommandItem>
            <Flag className="text-destructive" />
            Lena Fischer · Riverside
            <span data-slot="command-shortcut" className="ml-auto font-mono text-xs text-destructive">2.0</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Team">
          <CommandItem>
            <Users />
            Assign to duty manager
          </CommandItem>
          <CommandItem>
            <MapPin />
            Switch location
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
