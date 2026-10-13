"use client"

import { CircleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

import { ShareStateCard } from "@/components/share/share-state-card"

/**
 * The report could not be read (the database, not the link). Says so without
 * detail, offers nothing but trying again, and links nowhere into the app.
 */
export default function ShareReportError({ reset }: { reset: () => void }) {
  return (
    <ShareStateCard
      icon={<CircleAlertIcon />}
      title="This report couldn’t be loaded"
      description="Something went wrong on our side. Try again in a moment."
      action={
        <Button size="lg" className="w-full" onClick={() => reset()}>
          Try again
        </Button>
      }
    />
  )
}
