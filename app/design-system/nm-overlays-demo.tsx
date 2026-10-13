"use client"

import { ChevronDownIcon, XCircleIcon } from "lucide-react"
import * as React from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const VENUES = ["The Old Crown", "The Bell", "The Railway", "The White Horse"]

/** The search takeover: full screen below `sm`, the palette from `sm`. */
function SearchTakeover() {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open search
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Find a venue."
        phone="takeover"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search venues"
          trailing={
            query ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear search"
                className="text-ink-muted"
                onClick={() => setQuery("")}
              >
                <XCircleIcon aria-hidden />
              </Button>
            ) : null
          }
        />
        <CommandList>
          <CommandEmpty>No venue matches that.</CommandEmpty>
          <CommandGroup heading="Venues">
            {VENUES.map((venue) => (
              <CommandItem key={venue} onSelect={() => setOpen(false)}>
                {venue}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}

/** The switcher look: the current venue ticked at the row's end. */
function VenueSwitcher() {
  const [venue, setVenue] = React.useState(VENUES[0]!)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {venue}
        <ChevronDownIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" title="Switch venue">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Venues</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={venue}
            onValueChange={(next) => setVenue(next as string)}
          >
            {VENUES.map((name) => (
              <DropdownMenuRadioItem
                key={name}
                value={name}
                indicatorPosition="end"
              >
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DisconnectAlert() {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="danger-outline" />}>
        Disconnect Google
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
        <AlertDialogDescription>
          New reviews stop arriving until you reconnect. Replies already on
          Google stay there.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose render={<Button variant="danger" />}>
            Disconnect
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Drop 2 overlays: the phone search takeover, the switcher's trailing ✓,
 * the calm alert, the opaque popover and the flat tooltip and key hint.
 */
export function NmOverlaysDemo() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ui text-ink-muted">
        Menus and popovers float on the menu radius with the soft shadow,
        opaque. Search takes over a phone&apos;s whole screen with a Cancel
        beside the field.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SearchTakeover />
        <VenueSwitcher />
        <DisconnectAlert />
        <Popover>
          <PopoverTrigger render={<Button variant="secondary" />}>
            Sync status
          </PopoverTrigger>
          <PopoverContent title="Sync status">
            <PopoverTitle>Synced 4 min ago</PopoverTitle>
            <PopoverDescription>
              New reviews sync every 15 min.
            </PopoverDescription>
          </PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" />}>
            Search
          </TooltipTrigger>
          <TooltipContent>Search the inbox</TooltipContent>
        </Tooltip>
        <span className="text-ui text-ink-muted">
          Press <Kbd>/</Kbd> to search
        </span>
      </div>
    </div>
  )
}
