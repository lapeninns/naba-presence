"use client"

import { History } from "lucide-react"
import * as React from "react"

import { LocationActivityPanel } from "@/components/locations/activity-panel"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

/**
 * The location's change history, on demand.
 *
 * It used to be mounted under every tab, which meant every editor paid for a
 * request nobody asked for and every screen ended with a list of unrelated
 * mutations. History matters exactly when something looks wrong, so it lives
 * behind a control instead — and the request only fires once opened.
 *
 * Uncontrolled by default, with its own "Activity" button. The listing
 * header controls it (`open`/`onOpenChange`) so a phone's overflow menu can
 * open the same sheet; `triggerClassName` hides the button where that menu
 * takes over, and `returnFocus` is where focus goes on close when the
 * button itself is hidden.
 */
function ActivityDrawer({
  locationId,
  open: openProp,
  onOpenChange,
  triggerClassName,
  returnFocus,
}: {
  locationId: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false)
  const open = openProp ?? uncontrolled
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolled(next)
    onOpenChange?.(next)
  }
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        ref={triggerRef}
        render={<Button variant="secondary" className={triggerClassName} />}
      >
        <History strokeWidth={1.75} aria-hidden />
        Activity
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex flex-col gap-0"
        finalFocus={() => {
          const trigger = triggerRef.current
          if (trigger && trigger.getClientRects().length > 0) return trigger
          return returnFocus?.current ?? true
        }}
      >
        <SheetHeader>
          <SheetTitle>Recent activity</SheetTitle>
          <SheetDescription>
            Google change attempts and confirmation results for this location.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {open ? (
            <LocationActivityPanel key={locationId} locationId={locationId} />
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

export { ActivityDrawer }
