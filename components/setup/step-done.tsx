"use client"

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
    <div className="flex flex-col items-start gap-4">
      <p className="text-body">
        {clientName} is connected and its reviews are syncing. New reviews will
        appear in your inbox as Google sends them.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={`/clients/${clientId}`} className={buttonVariants()}>
          Go to {clientName}
        </Link>
        <Link
          href={`/inbox?clientId=${clientId}`}
          className={buttonVariants({ variant: "outline" })}
        >
          Open the inbox
        </Link>
      </div>
    </div>
  )
}

export { StepDone }
