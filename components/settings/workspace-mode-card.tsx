"use client"

import { useMutation } from "@tanstack/react-query"
import Link from "next/link"
import * as React from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertActions, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { SettingsSection } from "@/components/settings/settings-section"
import { ApiClientError, isMfaStepUpError } from "@/lib/api/client"
import { changeWorkspaceMode } from "@/lib/api/session"
import { hardNavigate } from "@/lib/client/hard-navigate"
import type {
  OrganisationModeChangedResponse,
  WorkspaceMode,
} from "@/lib/contracts/session"
import { MFA_ENROLLMENT_REQUIRED } from "@/lib/contracts/wire-codes"
import { describeActionError } from "@/lib/errors/action-errors"
import { useSession } from "@/lib/queries/use-session"

const COPY: Record<
  WorkspaceMode,
  {
    current: string
    action: string
    confirmTitle: string
    confirmBody: string
  }
> = {
  business: {
    current:
      "This is a business workspace: all your locations sit together under your business.",
    action: "Switch to an agency workspace",
    confirmTitle: "Switch to an agency workspace?",
    confirmBody:
      "Your business becomes your first client, with its locations, team access and report shares unchanged. You can then add more clients.",
  },
  agency: {
    current:
      "This is an agency workspace: locations are grouped under the clients you manage.",
    action: "Switch to a business workspace",
    confirmTitle: "Switch to a business workspace?",
    confirmBody:
      "This needs one active client or none. That client becomes your business and stops being shown as a client. Every other location moves under it: those with no client and those under an archived client. Report share links for that client then show those locations too.",
  },
}

/** The counts a `workspace_mode_report_shares` refusal carries. */
function reportShareExposure(
  error: unknown
): { locationsToRefile: number; activeReportShares: number } | null {
  if (
    !(error instanceof ApiClientError) ||
    error.code !== "workspace_mode_report_shares"
  ) {
    return null
  }
  const details = error.details as
    { locationsToRefile?: unknown; activeReportShares?: unknown } | undefined
  return {
    locationsToRefile: Number(details?.locationsToRefile) || 0,
    activeReportShares: Number(details?.activeReportShares) || 0,
  }
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

/** Where this card lives; the success reload lands on the section itself. */
const SECTION_ID = "settings-workspace-type"
const RETURN_PATH = "/settings/policy"

/**
 * The server's answer to a confirmed switch, kept across the reload that
 * redraws the shell so the card can say what happened. Session-scoped,
 * written only after a 200 and removed as soon as it is read.
 */
const RESULT_KEY = "naba:workspace-mode-result"

type SwitchResult = Pick<
  OrganisationModeChangedResponse,
  "changed" | "refiledLocations"
> & { workspaceMode: WorkspaceMode }

function storeResult(result: OrganisationModeChangedResponse) {
  const stored: SwitchResult = {
    workspaceMode: result.organisation.workspaceMode,
    changed: result.changed,
    refiledLocations: result.refiledLocations,
  }
  try {
    window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(stored))
  } catch {
    // Storage unavailable (private mode, quota): the reload still shows
    // the new mode, only without the note.
  }
}

/** Reads and removes the stored result; null when absent or malformed. */
function takeResult(): SwitchResult | null {
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(RESULT_KEY)
    window.sessionStorage.removeItem(RESULT_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (
      (value.workspaceMode !== "business" &&
        value.workspaceMode !== "agency") ||
      typeof value.changed !== "boolean" ||
      typeof value.refiledLocations !== "number"
    ) {
      return null
    }
    return {
      workspaceMode: value.workspaceMode,
      changed: value.changed,
      refiledLocations: value.refiledLocations,
    }
  } catch {
    return null
  }
}

function resultMessage(result: SwitchResult): string {
  if (!result.changed) {
    return `This was already ${result.workspaceMode === "agency" ? "an agency" : "a business"} workspace. Nothing changed.`
  }
  if (result.workspaceMode === "agency") {
    return "Switched. This is now an agency workspace. You can add clients from Clients."
  }
  return result.refiledLocations > 0
    ? `Switched. This is now a business workspace. ${plural(result.refiledLocations, "location was", "locations were")} filed under your business.`
    : "Switched. This is now a business workspace."
}

/**
 * A full load of Reply policy at the section. `location.assign` to the
 * same path with only a new #fragment scrolls without loading, so on that
 * page the load is asked for explicitly: the shell's words must be drawn
 * again for the new mode.
 */
function reloadAtSection() {
  const samePage =
    window.location.pathname === RETURN_PATH && window.location.search === ""
  hardNavigate(`${RETURN_PATH}#${SECTION_ID}`)
  if (samePage) window.location.reload()
}

const linkClass = (variant: "secondary" | "ghost") =>
  buttonVariants({ variant, size: "sm" })

/**
 * Lets an owner switch the organisation between business and agency mode.
 * Settings renders it only for owners of an organisation with the
 * `workspace_mode_change` feature on; the route enforces both again.
 *
 * Every word in the app shell depends on the mode, so a successful switch
 * reloads the page rather than patching the cached session.
 *
 * When switching to business would file locations under a client with live
 * report share links, the route refuses with the counts; the dialog then
 * says so and a second confirmation sends `confirmReportShares`.
 *
 * `billingEnabled` (the server's BILLING_ENABLED) decides whether a billing
 * refusal links to Billing: with billing off that page doesn't exist.
 */
export function WorkspaceModeCard({
  billingEnabled = false,
}: {
  billingEnabled?: boolean
}) {
  const session = useSession().data?.session
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<{
    message: string
    code: string | null
  } | null>(null)
  // Two-step verification was asked for: the route's 403 isn't a lack of
  // permission, and the step-up prompt is already open.
  // "enrol" when two-step verification is not set up yet: the prompt that
  // opened asks for set-up, not a code.
  const [stepUp, setStepUp] = React.useState<"code" | "enrol" | null>(null)
  const [result, setResult] = React.useState<SwitchResult | null>(null)
  const [exposure, setExposure] =
    React.useState<ReturnType<typeof reportShareExposure>>(null)
  const target: WorkspaceMode =
    session?.workspaceMode === "business" ? "agency" : "business"

  // After the reload a confirmed switch asked for, say once what the server
  // did. Read after hydration, so the polite status is announced.
  React.useEffect(() => {
    const stored = takeResult()
    // A one-time read of browser storage, which the server render can't
    // see; reading it during render would also consume it twice in Strict
    // Mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (stored) setResult(stored)
  }, [])

  const change = useMutation({
    mutationFn: (confirmReportShares: boolean) =>
      confirmReportShares
        ? changeWorkspaceMode(target, { confirmReportShares })
        : changeWorkspaceMode(target),
    onSuccess: (response) => {
      setConfirming(false)
      // Back to Reply policy, where this card lives, at every width: on a
      // phone /settings is the settings index, not this page. A full load,
      // so the shell's nav and wording are drawn again for the new mode,
      // landing on this section with the server's answer to show.
      storeResult(response)
      reloadAtSection()
    },
    onError: (caught) => {
      const shares = reportShareExposure(caught)
      if (shares) {
        // Keep the dialog open and ask again, now with the counts.
        setExposure(shares)
        return
      }
      setConfirming(false)
      if (isMfaStepUpError(caught)) {
        setError(null)
        setStepUp(caught.code === MFA_ENROLLMENT_REQUIRED ? "enrol" : "code")
        return
      }
      setError({
        message: describeActionError(caught),
        code: caught instanceof ApiClientError ? caught.code : null,
      })
    },
  })

  // Nothing renders until the session has loaded, so the copy and the
  // target never come from a guessed mode.
  if (!session || session.role !== "owner") return null
  const copy = COPY[session.workspaceMode]

  return (
    <SettingsSection
      id={SECTION_ID}
      title="Workspace type"
      description={copy.current}
      variant="group"
      contentClassName="items-start"
    >
      {result ? (
        <Alert variant="success">
          <AlertDescription>{resultMessage(result)}</AlertDescription>
        </Alert>
      ) : null}
      {stepUp ? (
        <Alert variant="info">
          <AlertDescription>
            {stepUp === "enrol"
              ? "Set up two-step verification in the window that opened, then switch again. Nothing was changed."
              : "Confirm it’s you in the window that opened, then switch again. Nothing was changed."}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
          {error.code === "workspace_mode_too_many_clients" ? (
            <AlertActions>
              <Link href="/clients" className={linkClass("secondary")}>
                Open Clients
              </Link>
            </AlertActions>
          ) : error.code === "billing_subscription_active" && billingEnabled ? (
            <AlertActions>
              <Link href="/settings/billing" className={linkClass("secondary")}>
                Open Billing
              </Link>
            </AlertActions>
          ) : null}
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setError(null)
          setStepUp(null)
          setResult(null)
          setExposure(null)
          setConfirming(true)
        }}
      >
        {copy.action}
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !change.isPending) setConfirming(false)
        }}
      >
        <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
          <AlertDialogTitle>{copy.confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{copy.confirmBody}</AlertDialogDescription>
          {exposure ? (
            <Alert variant="warning">
              <AlertDescription>
                {`${plural(exposure.locationsToRefile, "location", "locations")} will be filed under a client with ${plural(exposure.activeReportShares, "live report share link", "live report share links")}. Anyone with those links will see ${exposure.locationsToRefile === 1 ? "it" : "them"} too. If that is not what you want, revoke the links from the client’s Share report first.`}
              </AlertDescription>
              <AlertActions>
                <Link href="/clients" className={linkClass("ghost")}>
                  Open Clients
                </Link>
              </AlertActions>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="ghost" disabled={change.isPending}>
                  Keep it as it is
                </Button>
              }
            />
            <Button
              pending={change.isPending}
              pendingLabel="Switching…"
              onClick={() => change.mutate(exposure !== null)}
            >
              {exposure ? "Switch and share them" : copy.action}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
