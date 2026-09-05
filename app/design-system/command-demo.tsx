"use client"

import { Building2, Inbox } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"

// The palette is shown behind a button rather than inline: cmdk scrolls its
// selected row into view when it mounts, and an inline palette near the foot
// of a long page drags the whole window down to it on load. Opening it in
// the dialog is also how the app presents it.
export function CommandDemo({ locations }: { locations: readonly string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open palette
        <Kbd variant="plain">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search actions and clients" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => setOpen(false)}>
              <Inbox strokeWidth={1.75} className="size-4" aria-hidden />
              <span className="flex-1">Inbox</span>
              <CommandShortcut>G I</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => setOpen(false)}>
              <Building2 strokeWidth={1.75} className="size-4" aria-hidden />
              <span className="flex-1">Clients</span>
              <CommandShortcut>G C</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Clients">
            {locations.map((location) => (
              <CommandItem key={location} onSelect={() => setOpen(false)}>
                <span className="flex-1">{location}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
