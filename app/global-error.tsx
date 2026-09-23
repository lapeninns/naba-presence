"use client"

import { TriangleAlert } from "lucide-react"
import * as React from "react"

import "./globals.css"
import { BrandMark } from "@/components/app-shell/brand-mark"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The root boundary: the root layout itself failed, so this file draws its
 * own `html` and `body`, and imports the stylesheet itself: the root layout
 * that normally loads it is exactly what is not rendering. Metadata exports
 * are not supported here, so the title is a React `<title>`.
 *
 * The digest, when Next.js forwards one, is the only identifier shown; the
 * error's message may carry details the viewer should not see.
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
          className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10 outline-none"
        >
          <BrandMark size="lg" />
          <section
            aria-labelledby="global-error-title"
            className="flex w-full max-w-[460px] flex-col gap-4 rounded-2xl border border-line bg-surface p-[clamp(20px,5vw,32px)]"
          >
            <span
              aria-hidden
              className="grid size-11 place-items-center rounded-lg bg-danger-tint text-danger-ink"
            >
              <TriangleAlert className="size-5" strokeWidth={1.75} />
            </span>
            <div className="flex flex-col gap-1.5">
              <h1
                id="global-error-title"
                className="font-display text-page-title font-semibold text-balance"
              >
                Something went wrong
              </h1>
              <p className="text-body text-ink-muted">
                NabaPresence hit an unexpected error before the page could load.
                Your data is unaffected.
              </p>
            </div>
            {error.digest ? (
              <p className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                Reference
                <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-[12px] [overflow-wrap:anywhere] text-ink">
                  {error.digest}
                </code>
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={() =>
                  startTransition(() => {
                    ;(unstable_retry ?? reset)()
                  })
                }
              >
                {pending ? "Trying again…" : "Try again"}
              </Button>
              {/* A plain anchor, not next/link: the router may be what
                  failed, and a full navigation starts clean. */}
              <a
                href="/inbox"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "lg" }),
                  "w-full"
                )}
              >
                Go to Inbox
              </a>
            </div>
          </section>
          <p className="max-w-[460px] text-center text-caption text-ink-muted">
            If this keeps happening, share the reference with an owner or admin
            in your agency.
          </p>
        </main>
      </body>
    </html>
  )
}
