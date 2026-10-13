"use client"

import { Copy, RotateCw, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import {
  BoundaryCode,
  BoundaryFrame,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"
import { useWorkspaceTerms } from "@/lib/workspace/mode"

const AREAS: Record<string, string> = {
  inbox: "Inbox",
  listings: "Listings",
  clients: "Clients",
  reports: "Reports",
  team: "Team",
  settings: "Settings",
  setup: "Setup",
}

/**
 * The page failed; the shell around it did not. The sidebar and toolbar are
 * still there, so the actions offered are the ones only this boundary can
 * perform (try the page again) and the way back to work.
 *
 * The error's digest is the one identifier Next.js forwards from a server
 * failure; it is shown in mono so it can be matched to the server logs, and
 * never a message, which may carry details the viewer should not see.
 *
 * Plain markup and the light helpers in components/app-shell/boundary.tsx
 * only: this file is bundled into every dashboard segment's error chunk.
 */
export default function DashboardError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  unstable_retry?: () => void
}) {
  const pathname = usePathname() ?? ""
  const { orgLower } = useWorkspaceTerms()
  const segment = pathname.split("/").filter(Boolean)[0] ?? ""
  const area = AREAS[segment] ?? "This page"
  const [pending, startTransition] = React.useTransition()
  const [copied, setCopied] = React.useState<"copied" | "manual" | null>(null)
  const [when] = React.useState(() =>
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date())
  )
  const retry = () =>
    startTransition(() => {
      ;(unstable_retry ?? reset)()
    })
  const summary = [
    "NabaPresence error",
    area,
    pathname,
    error.digest ? `digest ${error.digest}` : null,
    when,
  ]
    .filter(Boolean)
    .join(" · ")
  const details = [
    {
      term: "Page",
      value: (
        <span className="flex flex-wrap items-center gap-2">
          {area}
          {pathname ? (
            <span className="font-mono text-caption text-ink-muted">
              {pathname}
            </span>
          ) : null}
        </span>
      ),
    },
    ...(error.digest
      ? [
          {
            term: "Reference",
            value: <BoundaryCode>{error.digest}</BoundaryCode>,
          },
        ]
      : []),
    { term: "When", value: when },
  ]

  // This boundary replaces the whole page; AppShell owns the <main>.
  return (
    <BoundaryFrame>
      <div
        data-slot="page-empty-state"
        className="flex flex-col items-center gap-2 pt-6 text-center sm:pt-12 lg:pt-16"
      >
        <span
          aria-hidden
          className="mb-1 grid size-11 place-items-center rounded-lg bg-danger-tint text-danger-ink"
        >
          <TriangleAlert className="size-5" strokeWidth={1.5} />
        </span>
        <h1
          tabIndex={-1}
          className="text-title font-medium text-balance text-ink outline-none"
        >
          {`${area} hit an error`}
        </h1>
        <p className="max-w-md text-ui text-pretty text-ink-muted">
          The rest of NabaPresence is still working. Your data is unaffected.
        </p>
        <div className="mt-3 flex w-full max-w-sm flex-col items-stretch gap-1 sm:w-auto sm:items-center">
          <button
            type="button"
            onClick={retry}
            disabled={pending}
            aria-busy={pending || undefined}
            className={boundaryButtonClass(
              "primary",
              "default",
              "pointer-coarse:min-h-11"
            )}
          >
            <RotateCw strokeWidth={1.75} aria-hidden />
            {pending ? "Trying again…" : "Try again"}
          </button>
          <Link
            href="/inbox"
            className={boundaryButtonClass(
              "ghost",
              "default",
              "text-ink-secondary pointer-coarse:min-h-11"
            )}
          >
            Back to Inbox
          </Link>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-(--np-gap-section)">
        <section
          aria-labelledby="error-what-failed"
          className="flex min-w-0 flex-col gap-3"
        >
          <h2
            id="error-what-failed"
            className="text-ui font-medium text-ink-muted"
          >
            What failed
          </h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-ui sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-2.5">
            {details.map((item) => (
              <React.Fragment key={item.term}>
                <dt className="text-ink-muted">{item.term}</dt>
                <dd className="mb-2.5 min-w-0 [overflow-wrap:anywhere] text-ink sm:mb-0">
                  {item.value}
                </dd>
              </React.Fragment>
            ))}
          </dl>
          <div className="flex flex-col items-start gap-1.5">
            <button
              type="button"
              className={boundaryButtonClass(
                "outline",
                "default",
                "pointer-coarse:min-h-11"
              )}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(summary)
                  setCopied("copied")
                } catch {
                  setCopied("manual")
                }
              }}
            >
              <Copy strokeWidth={1.75} aria-hidden />
              Copy error details
            </button>
            <p role="status" className="text-caption text-ink-muted">
              {copied === "copied"
                ? "Error details copied."
                : copied === "manual"
                  ? `Copy this: “${summary}”`
                  : ""}
            </p>
          </div>
        </section>
        <section
          aria-labelledby="error-next-steps"
          className="flex flex-col gap-2"
        >
          <h2
            id="error-next-steps"
            className="text-ui font-medium text-ink-muted"
          >
            If it keeps happening
          </h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ui text-ink">
            <li>
              Try again once. Brief outages usually clear within a minute.
            </li>
            <li>Open another page to check the rest of NabaPresence works.</li>
            <li>
              Share the page and reference with an owner or admin in your{" "}
              {orgLower}.
            </li>
          </ol>
        </section>
      </div>
    </BoundaryFrame>
  )
}
