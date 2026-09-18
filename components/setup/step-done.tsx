"use client"

import { CircleCheck } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

/** The end of the flow: where the actual work happens. */
function StepDone({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <CircleCheck
        aria-hidden
        strokeWidth={1.5}
        className="size-16 text-[var(--np-success-solid)]"
      />
      <p className="max-w-md text-body text-ink">
        {clientName} is connected and its reviews are syncing. New reviews will
        appear in your inbox as Google sends them.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href={`/inbox?clientId=${clientId}`}
          className={buttonVariants({ variant: "secondary", pill: true })}
        >
          Open the inbox
        </Link>
        <Link
          href={`/clients/${clientId}`}
          className={buttonVariants({ variant: "secondary", pill: true })}
        >
          Go to {clientName}
        </Link>
        {/* The listings are what was just linked, and the board is where
            each one's health and verification show from the first visit. */}
        <Link
          href={`/listings?clientId=${clientId}`}
          className={buttonVariants({ pill: true })}
        >
          Open its listings
        </Link>
      </div>
    </div>
  )
}

export { StepDone }
