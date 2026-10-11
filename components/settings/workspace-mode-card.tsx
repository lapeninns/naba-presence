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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
      "A business workspace has one client, which stops being shown as a client. Any location without a client is filed under it. This only works while one client or none is active.",
  },
}

/**
 * Lets an owner switch the organisation between business and agency mode.
 * Settings renders it only for owners of an organisation with the
 * `workspace_mode_change` feature on; the route enforces both again.
 *
 * Every word in the app shell depends on the mode, so a successful switch
 * reloads the page rather than patching the cached session.
 */
export function WorkspaceModeCard() {
  const session = useSession().data?.session
  const mode = session?.workspaceMode ?? "agency"
  const target: WorkspaceMode = mode === "business" ? "agency" : "business"
  const copy = COPY[mode]
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const change = useMutation({
    mutationFn: () => changeWorkspaceMode(target),
    onSuccess: () => {
      setConfirming(false)
      hardNavigate("/settings")
    },
    onError: (caught) => {
      setConfirming(false)
      setError(describeActionError(caught))
    },
  })

  if (session?.role !== "owner") return null

  return (
    <Card flush>
      <CardHeader divided>
        <CardTitle as="h2">Workspace type</CardTitle>
        <CardDescription>{copy.current}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3 py-(--np-card-pad)">
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
            setConfirming(true)
          }}
        >
          {copy.action}
        </Button>
      </CardContent>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !change.isPending) setConfirming(false)
        }}
      >
        <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
          <AlertDialogTitle>{copy.confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{copy.confirmBody}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep it as it is</Button>}
            />
            <Button
              pending={change.isPending}
              pendingLabel="Switching…"
              onClick={() => change.mutate()}
            >
              {copy.action}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
