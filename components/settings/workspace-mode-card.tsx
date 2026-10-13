"use client"

import { useMutation } from "@tanstack/react-query"
import * as React from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SettingsSection } from "@/components/settings/settings-section"
import { ApiClientError } from "@/lib/api/client"
import { changeWorkspaceMode } from "@/lib/api/session"
import { hardNavigate } from "@/lib/client/hard-navigate"
import type { WorkspaceMode } from "@/lib/contracts/session"
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
      "This is a business workspace: your locations sit together with no client layer.",
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
      "A business workspace has one client, which stops being shown as a client. Every other location is filed under it: those without a client and those still under an archived client. Report share links for that client then cover those locations too. This only works while one client or none is active.",
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
 */
export function WorkspaceModeCard() {
  const session = useSession().data?.session
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [exposure, setExposure] =
    React.useState<ReturnType<typeof reportShareExposure>>(null)
  const target: WorkspaceMode =
    session?.workspaceMode === "business" ? "agency" : "business"

  const change = useMutation({
    mutationFn: (confirmReportShares: boolean) =>
      confirmReportShares
        ? changeWorkspaceMode(target, { confirmReportShares })
        : changeWorkspaceMode(target),
    onSuccess: () => {
      setConfirming(false)
      // Back to Reply policy, where this card lives, at every width: on a
      // phone /settings is the settings index, not this page. A full load,
      // so the shell's nav and wording are drawn again for the new mode.
      hardNavigate("/settings/policy")
    },
    onError: (caught) => {
      const shares = reportShareExposure(caught)
      if (shares) {
        // Keep the dialog open and ask again, now with the counts.
        setExposure(shares)
        return
      }
      setConfirming(false)
      setError(describeActionError(caught))
    },
  })

  // Nothing renders until the session has loaded, so the copy and the
  // target never come from a guessed mode.
  if (!session || session.role !== "owner") return null
  const copy = COPY[session.workspaceMode]

  return (
    <SettingsSection
      id="settings-workspace-type"
      title="Workspace type"
      description={copy.current}
      variant="group"
      contentClassName="items-start"
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setError(null)
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
                {`${plural(exposure.locationsToRefile, "location", "locations")} will be filed under a client with ${plural(exposure.activeReportShares, "live report share link", "live report share links")}. Anyone with those links will see ${exposure.locationsToRefile === 1 ? "it" : "them"} too. Revoke the links in Reports first if that is not what you want.`}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep it as it is</Button>}
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
