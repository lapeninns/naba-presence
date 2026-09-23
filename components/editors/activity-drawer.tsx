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
 */
function ActivityDrawer({ locationId }: { locationId: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="secondary" />}>
        <History strokeWidth={1.75} aria-hidden />
        Activity
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>Recent activity</SheetTitle>
          <SheetDescription>
            Changes published to Google for this location.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {open ? <LocationActivityPanel locationId={locationId} /> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

export { ActivityDrawer }
