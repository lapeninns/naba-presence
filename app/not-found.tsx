import { FileQuestion } from "lucide-react"
import Link from "next/link"

import { boundaryButtonClass } from "@/components/app-shell/boundary"
import { BrandMark } from "@/components/app-shell/brand-mark"

export const metadata = { title: "Page not found · NabaPresence" }

/**
 * The root 404, outside the shell: no sidebar, so the page is the wordmark
 * and a calm, centred empty state whose one action is the way back in. On a
 * phone it sits on the canvas; from `sm` it gets a card.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh flex-col items-center justify-center gap-6 bg-canvas px-safe py-10 text-ink outline-none"
    >
      <Link
        href="/inbox"
        className="inline-flex min-h-(--np-touch) items-center rounded-md focus-halo focus-visible:outline-none"
      >
        <BrandMark size="lg" />
      </Link>
      <section
        aria-labelledby="not-found-title"
        className="flex w-full max-w-md flex-col items-center gap-2 px-5 text-center sm:rounded-2xl sm:border sm:border-line sm:bg-surface sm:p-8"
      >
        <span
          aria-hidden
          className="mb-1 grid size-11 place-items-center rounded-lg bg-fill text-ink-secondary"
        >
          <FileQuestion className="size-5" strokeWidth={1.5} />
        </span>
        <h1
          id="not-found-title"
          className="text-title font-medium text-balance text-ink"
        >
          Page not found
        </h1>
        <p className="text-ui text-pretty text-ink-muted">
          The page you’re looking for doesn’t exist or has moved. Nothing was
          changed.
        </p>
        <Link
          href="/inbox"
          className={boundaryButtonClass("primary", "lg", "mt-3 w-full")}
        >
          Go to Inbox
        </Link>
      </section>
    </main>
  )
}
