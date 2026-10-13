"use client"

import { TriangleAlert } from "lucide-react"
import * as React from "react"

import "./globals.css"
import { boundaryButtonClass } from "@/components/app-shell/boundary"

/**
 * The root boundary: the root layout itself failed, so this file draws its
 * own `html` and `body`, and imports the stylesheet itself: the root layout
 * that normally loads it is exactly what is not rendering. Metadata exports
 * are not supported here, so the title is a React `<title>`.
 *
 * The digest, when Next.js forwards one, is the only identifier shown; the
 * error's message may carry details the viewer should not see.
 *
 * Plain markup and the light helpers in components/app-shell/boundary.tsx
 * only: no primitives, no class merging, nothing that could itself be what
 * failed to load.
 */
export default function GlobalError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  unstable_retry?: () => void
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <html lang="en-GB">
      <body className="bg-canvas font-sans text-ink antialiased">
        <title>Something went wrong · NabaPresence</title>
        <main
          id="main"
          tabIndex={-1}
          className="flex min-h-svh flex-col items-center justify-center gap-6 px-safe py-10 outline-none"
        >
          {/* BrandMark (size lg), drawn inline. */}
          <span
            data-slot="brand-mark"
            className="flex min-w-0 items-center gap-2.5"
          >
            <span
              aria-hidden
              translate="no"
              className="grid size-8 shrink-0 place-items-center rounded-md bg-ink font-display text-title leading-none font-bold text-canvas"
            >
              N
            </span>
            <span
              className="truncate text-title font-semibold tracking-[-0.005em] text-ink"
              translate="no"
            >
              NabaPresence
            </span>
          </span>
          <section
            aria-labelledby="global-error-title"
            className="flex w-full max-w-md flex-col items-center gap-2 px-5 text-center sm:rounded-2xl sm:border sm:border-line sm:bg-surface sm:p-8"
          >
            <span
              aria-hidden
              className="mb-1 grid size-11 place-items-center rounded-lg bg-danger-tint text-danger-ink"
            >
              <TriangleAlert className="size-5" strokeWidth={1.5} />
            </span>
            <h1
              id="global-error-title"
              className="text-title font-medium text-balance text-ink"
            >
              Something went wrong
            </h1>
            <p className="text-ui text-pretty text-ink-muted">
              NabaPresence hit an unexpected error before the page could load.
              Your data is unaffected.
            </p>
            {error.digest ? (
              <p className="flex max-w-full flex-wrap items-center justify-center gap-2 text-caption text-ink-muted">
                Reference
                <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-caption [overflow-wrap:anywhere] text-ink">
                  {error.digest}
                </code>
              </p>
            ) : null}
            <div className="mt-3 flex w-full flex-col gap-1">
              <button
                type="button"
                className={boundaryButtonClass("primary", "lg", "w-full")}
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={() =>
                  startTransition(() => {
                    ;(unstable_retry ?? reset)()
                  })
                }
              >
                {pending ? "Trying again…" : "Try again"}
              </button>
              {/* A plain anchor, not next/link: the router may be what
                  failed, and a full navigation starts clean. */}
              <a
                href="/inbox"
                className={boundaryButtonClass("ghost", "lg", "w-full")}
              >
                Go to Inbox
              </a>
            </div>
          </section>
          <p className="max-w-md px-5 text-center text-caption text-pretty text-ink-muted">
            If this keeps happening, share the reference with an owner or admin
            in your workspace.
          </p>
        </main>
      </body>
    </html>
  )
}
