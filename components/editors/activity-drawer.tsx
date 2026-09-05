"use client"

import { History } from "lucide-react"
import * as React from "react"

import { LocationActivityPanel } from "@/components/locations/activity-panel"
import { Button } from "@/components/ui/button"
import {
  Sheet,
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
      <SheetContent side="right" className="md:max-w-lg">
        <SheetHeader>
          <SheetTitle>Recent activity</SheetTitle>
          <SheetDescription>
            Changes published to Google for this location.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {open ? <LocationActivityPanel locationId={locationId} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { ActivityDrawer }
