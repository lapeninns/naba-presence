"use client"

import { RotateCw, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import {
  Code,
  CopyTextButton,
  DetailList,
  SystemCard,
} from "@/components/app-shell/system-page"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
  const segment = pathname.split("/").filter(Boolean)[0] ?? ""
  const area = AREAS[segment] ?? "This page"
  const [pending, startTransition] = React.useTransition()
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

  // This boundary replaces the whole page, so it owns the <main> landmark.
  return (
    <PageFrame>
      <PageEmptyState
        tone="danger"
        icon={<TriangleAlert strokeWidth={1.75} />}
        eyebrow="Page error"
        title={`${area} hit an error`}
        description="The rest of NabaPresence is still working. Your data is unaffected."
        action={
          <>
            <Button
              type="button"
              onClick={retry}
              disabled={pending}
              aria-busy={pending || undefined}
              className="pointer-coarse:min-h-11"
            >
              <RotateCw strokeWidth={1.75} aria-hidden />
              {pending ? "Trying again…" : "Try again"}
            </Button>
            <Link
              href="/inbox"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "pointer-coarse:min-h-11"
              )}
            >
              Back to Inbox
            </Link>
          </>
        }
      />

      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SystemCard title="What failed">
          <DetailList
            items={[
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
                ? [{ term: "Reference", value: <Code>{error.digest}</Code> }]
                : []),
              { term: "When", value: when },
            ]}
          />
          <CopyTextButton
            text={summary}
            label="Copy error details"
            copiedMessage="Error details copied."
          />
        </SystemCard>
        <aside
          aria-labelledby="error-next-steps"
          className="flex flex-col gap-2.5 rounded-lg bg-surface-alt p-4"
        >
          <h2
            id="error-next-steps"
            className="text-body font-semibold text-ink"
          >
            If it keeps happening
          </h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ui text-ink">
            <li>
              Try again once. Brief outages usually clear within a minute.
            </li>
            <li>Open another page to check the rest of NabaPresence works.</li>
            <li>
              Share the page and reference with an owner or admin in your
              agency.
            </li>
          </ol>
        </aside>
      </div>
    </PageFrame>
  )
}
