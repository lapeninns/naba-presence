"use client"

import { CircleAlert, RotateCw } from "lucide-react"
import * as React from "react"

import "./globals.css"
import { boundaryButtonClass } from "@/components/app-shell/boundary"

/**
 * next-themes' stored choice (its default `storageKey`). This document
 * replaces the root layout, so ThemeProvider's class never reaches it: with
 * no class the operating system's scheme decides (globals.css), and a stored
 * "light" or "dark" is put back once this has mounted.
 */
const THEME_STORAGE_KEY = "theme"

function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === "light" || stored === "dark" ? stored : undefined
  } catch {
    // Storage can be blocked; the operating system's scheme stands.
    return undefined
  }
}

const noSubscription = () => () => {}

function useStoredTheme() {
  return React.useSyncExternalStore(
    noSubscription,
    readStoredTheme,
    () => undefined
  )
}

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
 * failed to load. The state is drawn as `Empty variant="error"` draws it
 * (the 20px danger glyph, the title, one sentence), so it reads as every
 * other error in the product.
 *
 * "Try again" re-runs the root: Next 16.3+ passes that as `retry`
 * (`unstable_retry` before), while `reset` only re-renders what failed.
 */
export default function GlobalError({
  error,
  reset,
  retry,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  retry?: () => void
  unstable_retry?: () => void
}) {
  const [pending, startTransition] = React.useTransition()
  const theme = useStoredTheme()
  return (
    <html lang="en-GB" className={theme}>
      <body className="bg-canvas font-sans text-ink antialiased">
        <title>Something went wrong · NabaPresence</title>
        <div className="flex min-h-svh flex-col items-center justify-center gap-6 pt-safe px-safe pb-safe">
          <header className="flex min-h-(--np-touch) items-center pt-10 sm:pt-0">
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
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="flex w-full flex-col items-center gap-6 pb-10 outline-none"
          >
            <section
              aria-labelledby="global-error-title"
              data-slot="empty"
              data-variant="error"
              className="flex w-full max-w-md flex-col items-center gap-1.5 px-5 text-center sm:rounded-(--np-radius-card) sm:border sm:border-line sm:bg-surface sm:p-8"
            >
              <span
                aria-hidden
                data-slot="empty-icon"
                className="mb-1 flex text-danger-ink"
              >
                <CircleAlert className="size-5 shrink-0" strokeWidth={1.75} />
              </span>
              <h1
                id="global-error-title"
                className="text-title font-semibold text-balance text-ink"
              >
                Something went wrong
              </h1>
              <p className="max-w-sm text-ui text-pretty text-ink-muted">
                The page couldn’t load. Nothing was changed.
              </p>
              {error.digest ? (
                <p className="flex max-w-full flex-wrap items-center justify-center gap-2 text-caption text-ink-muted">
                  Error reference
                  <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-caption [overflow-wrap:anywhere] text-ink">
                    {error.digest}
                  </code>
                </p>
              ) : null}
              <div className="mt-2.5 flex w-full flex-col gap-1">
                <button
                  type="button"
                  className={boundaryButtonClass("primary", "lg", "w-full")}
                  // aria-disabled, not disabled: a disabled button drops the
                  // focus it holds, and the retry is the page's one action.
                  aria-disabled={pending || undefined}
                  aria-busy={pending || undefined}
                  onClick={() =>
                    !pending &&
                    startTransition(() => {
                      ;(retry ?? unstable_retry ?? reset)()
                    })
                  }
                >
                  <RotateCw strokeWidth={1.75} aria-hidden />
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
              {error.digest
                ? "If this keeps happening, share the error reference with an owner or admin in your workspace."
                : "If this keeps happening, tell an owner or admin in your workspace."}
            </p>
          </main>
        </div>
      </body>
    </html>
  )
}
