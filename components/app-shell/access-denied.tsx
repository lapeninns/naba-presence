"use client"

import { QueryClientContext } from "@tanstack/react-query"
import { ArrowLeft, Lock, Share2 } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import { useShellBack } from "@/components/app-shell/breadcrumbs-context"
import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import {
  CopyTextButton,
  DetailList,
  SystemCard,
} from "@/components/app-shell/system-page"
import { SupportDetails } from "@/components/editors/support-details"
import { Button, buttonVariants } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { useSession } from "@/lib/queries/use-session"
import { shareLink } from "@/lib/setup/share-link"
import { cn } from "@/lib/utils"
import { useWorkspaceTerms } from "@/lib/workspace/mode"

import { roleExplanation, ROLE_LABEL } from "./account-menu"

/**
 * An explicit "you don't have access" page.
 *
 * Every role-gated route used to `redirect()` somewhere else, so a member who
 * followed a colleague's link to Connections silently landed on the policy
 * page with no explanation. Being told what you cannot reach, and who can
 * grant it, is the difference between a permission model and a bug.
 *
 * The one thing that helps is the primary action: "Ask for access" hands a
 * short request and this page's address to the system share sheet (or copies
 * the address where there is none), so it can reach whoever can grant it
 * without leaving the page to compose anything. The quiet second action goes
 * where the app bar's back control goes, not always to the Inbox.
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
  const { orgLower } = useWorkspaceTerms()
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {/* Neutral, not a warning: nothing is wrong, the page belongs to a
          role. The sentence names the role and who can grant it. Inline,
          not page placement: the access details below belong on screen
          with it. */}
      <PageEmptyState
        placement="inline"
        icon={<Lock />}
        title="You don’t have access to this page"
        description={`${area} is limited to ${whoCanHelp}. Ask ${whoCanHelp} in your ${orgLower} if you need it.`}
        action={<AccessActions area={area} whoCanHelp={whoCanHelp} />}
      />
      <SignedInAccess area={area} whoCanHelp={whoCanHelp} />
      <AccessSupportDetails />
    </div>
  )
}

/**
 * Ask for access (primary) and the way back (quiet). The request names the
 * signed-in person when the session the dashboard hydrated is available;
 * without a query client (a bare render) it is the plain sentence.
 */
function AccessActions(props: { area: string; whoCanHelp: string }) {
  const client = React.useContext(QueryClientContext)
  return client ? (
    <AccessActionsWithSession {...props} />
  ) : (
    <AccessActionButtons
      {...props}
      request={accessRequest(props.area)}
      back={null}
    />
  )
}

function AccessActionsWithSession(props: { area: string; whoCanHelp: string }) {
  const session = useSession().data?.session
  const back = useShellBack()
  return (
    <AccessActionButtons
      {...props}
      request={accessRequest(props.area, session)}
      back={back}
    />
  )
}

type AccessSession = NonNullable<
  ReturnType<typeof useSession>["data"]
>["session"]

function accessRequest(area: string, session?: AccessSession) {
  if (!session) {
    return `Hi, could you give me access to ${area} in NabaPresence?`
  }
  const roleLabel = ROLE_LABEL[session.role] ?? session.role
  return `Hi, could you give me access to ${area} in NabaPresence? I'm ${session.displayName} (${session.email}), currently a ${roleLabel.toLowerCase()} in ${session.organisationName}.`
}

function AccessActionButtons({
  area,
  whoCanHelp,
  request,
  back,
}: {
  area: string
  whoCanHelp: string
  request: string
  back: { href: string; label: string } | null
}) {
  // Where the app bar's back control goes; the Inbox only when the shell has
  // no parent to offer (a top-level page such as Team).
  const target = back ?? { href: "/inbox", label: "Inbox" }

  async function askForAccess() {
    const outcome = await shareLink({
      url: window.location.href,
      title: `Access to ${area}`,
      text: request,
    })
    if (outcome === "copied") {
      toast.add({
        title: "Link copied",
        description: `Paste it to ${whoCanHelp} and say what you need. Nothing was sent.`,
        type: "success",
      })
    } else if (outcome === "failed") {
      toast.add({
        title: "Couldn’t share or copy the link. Copy it from the address bar.",
        type: "error",
      })
    }
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-center">
      <Button
        type="button"
        className="pointer-coarse:min-h-11"
        onClick={() => void askForAccess()}
      >
        <Share2 strokeWidth={1.75} aria-hidden />
        Ask for access
      </Button>
      <Link
        href={target.href}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "pointer-coarse:min-h-11"
        )}
      >
        <ArrowLeft strokeWidth={1.75} aria-hidden />
        Back to {target.label}
      </Link>
    </div>
  )
}

/**
 * The address they asked for, for whoever supports them: folded away so the
 * page leads with what they can do, not with a path.
 */
function AccessSupportDetails() {
  const pathname = usePathname()
  return (
    <SupportDetails items={[pathname]} className="mx-auto w-full max-w-xl" />
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
  const explanation = roleExplanation(session.role, session.workspaceMode)
  const request = accessRequest(area, session)

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
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
                  <span className="inline-flex h-5 items-center rounded-sm bg-fill px-1.5 text-caption font-medium text-ink-secondary">
                    {roleLabel}
                  </span>
                  {explanation ? (
                    <span className="text-caption text-ink-muted">
                      {explanation}
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
