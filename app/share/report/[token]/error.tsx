"use client"

import { CircleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The report could not be read (the database, not the link). Says so without
 * detail, offers nothing but trying again, and links nowhere into the app.
 */
export default function ShareReportError({ reset }: { reset: () => void }) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh flex-col items-center justify-center px-4 py-10 outline-none"
    >
      <section
        aria-labelledby="share-error-title"
        className="flex w-full max-w-[460px] flex-col gap-4 rounded-2xl border border-line bg-surface p-[clamp(20px,5vw,32px)]"
      >
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-lg bg-fill text-ink-secondary"
        >
          <CircleAlertIcon className="size-5" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1
            id="share-error-title"
            className="font-display text-page-title font-semibold text-balance"
          >
            This report couldn’t be loaded
          </h1>
          <p className="text-body text-ink-muted">
            Something went wrong on our side. Try again in a moment.
          </p>
        </div>
        <Button size="lg" className="w-full" onClick={() => reset()}>
          Try again
        </Button>
      </section>
    </main>
  )
}
