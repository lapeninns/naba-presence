"use client"

import { QueryClientContext } from "@tanstack/react-query"
import { ArrowLeft, Lock } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import {
  CopyTextButton,
  DetailList,
  SystemCard,
} from "@/components/app-shell/system-page"
import { buttonVariants } from "@/components/ui/button"
import { useSession } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

import { ROLE_EXPLANATION, ROLE_LABEL } from "./account-menu"

/**
 * An explicit "you don't have access" page.
 *
 * Every role-gated route used to `redirect()` somewhere else, so a member who
 * followed a colleague's link to Connections silently landed on the policy
 * page with no explanation. Being told what you cannot reach, and who can
 * grant it, is the difference between a permission model and a bug.
 *
 * Renders NO landmark of its own. Some callers sit inside a layout that
 * already owns the page's single `<main>` (Settings does), and a second one
 * breaks `landmark-no-duplicate-main`, which the axe suite pins. Routes with
 * no frame of their own use `AccessDeniedPage`.
 */
function AccessDenied({
  area,
  whoCanHelp = "an owner or admin",
}: {
  /** What they tried to reach, in the product's own words. */
  area: string
  whoCanHelp?: string
}) {
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <PageEmptyState
        tone="warning"
        icon={<Lock strokeWidth={1.75} />}
        eyebrow="No access · 403"
        title="You don’t have access to this page"
        description={`${area} is limited to ${whoCanHelp}. Ask ${whoCanHelp} in your agency if you need it.`}
        action={
          <Link
            href="/inbox"
            className={cn(buttonVariants(), "pointer-coarse:min-h-11")}
          >
            <ArrowLeft strokeWidth={1.75} aria-hidden />
            Back to Inbox
          </Link>
        }
      />
      <SignedInAccess area={area} whoCanHelp={whoCanHelp} />
    </div>
  )
}

/**
 * The signed-in person's side of the story, read from the session the
 * dashboard layout already hydrated. Without a query client (a bare render)
 * there is no session to read, so nothing is drawn rather than a guess.
 */
function SignedInAccess(props: { area: string; whoCanHelp: string }) {
  const client = React.useContext(QueryClientContext)
  if (!client) return null
  return <SignedInAccessCards {...props} />
}

function SignedInAccessCards({
  area,
  whoCanHelp,
}: {
  area: string
  whoCanHelp: string
}) {
  const session = useSession().data?.session
  if (!session) return null
  const roleLabel = ROLE_LABEL[session.role] ?? session.role
  const request = `Hi, could you give me access to ${area} in NabaPresence? I'm ${session.displayName} (${session.email}), currently a ${roleLabel.toLowerCase()} in ${session.organisationName}.`

  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      <SystemCard title="Your access">
        <DetailList
          items={[
            { term: "Page you asked for", value: area },
            {
              term: "Who can open it",
              value: whoCanHelp
                .replace(/^an? /, "")
                .replace(/^\w/, (c) => c.toUpperCase()),
            },
            {
              term: "Your role",
              value: (
                <span className="flex flex-col items-start gap-1">
                  <span className="inline-flex h-5 items-center rounded-sm bg-fill px-1.5 font-mono text-[0.71875rem] font-medium tracking-[0.02em] text-ink-secondary uppercase">
                    {roleLabel}
                  </span>
                  {ROLE_EXPLANATION[session.role] ? (
                    <span className="text-caption text-ink-muted">
                      {ROLE_EXPLANATION[session.role]}
                    </span>
                  ) : null}
                </span>
              ),
            },
            { term: "Signed in as", value: session.email },
          ]}
        />
      </SystemCard>
      <SystemCard
        title="Who can give you access"
        description={`Owners and admins in ${session.organisationName}. They change roles on the Team page.`}
      >
        <CopyTextButton
          text={request}
          label="Copy an access request"
          copiedMessage={`Copied. Paste it to ${whoCanHelp}. Nothing was sent.`}
        />
      </SystemCard>
    </div>
  )
}

/** The same message for a route that owns its own page frame. */
function AccessDeniedPage(props: React.ComponentProps<typeof AccessDenied>) {
  return (
    <PageFrame>
      <AccessDenied {...props} />
    </PageFrame>
  )
}

export { AccessDenied, AccessDeniedPage }
