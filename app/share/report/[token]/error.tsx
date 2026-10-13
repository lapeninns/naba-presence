"use client"

import { CircleAlertIcon } from "lucide-react"

import { boundaryButtonClass } from "@/components/app-shell/boundary"
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
        <button
          type="button"
          className={boundaryButtonClass("primary", "lg", "w-full")}
          onClick={() => reset()}
        >
          Try again
        </button>
      }
    />
  )
}
