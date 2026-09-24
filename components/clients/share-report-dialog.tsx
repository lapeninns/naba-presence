"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CopyIcon, RefreshCwIcon, Share2Icon } from "lucide-react"
import { useId, useState } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import {
  createReportShare,
  revokeReportShare,
  type ReportShare,
} from "@/lib/api/report-shares"
import {
  DEFAULT_REPORT_SHARE_EXPIRY_DAYS,
  REPORT_SHARE_EXPIRY_OPTIONS,
  type ReportShareExpiryDays,
} from "@/lib/contracts/report-shares"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { useReportShares } from "@/lib/queries/use-report-shares"
import { formatDay } from "@/lib/settings/roles"

function inDays(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString()
}

/** The one sentence that says what sharing means, with the real date. */
export function shareWarning(clientName: string, expiresAt: string): string {
  return `Anyone with this link can see ${clientName}’s review and Google numbers until ${formatDay(expiresAt)}. No reviews or names are shown.`
}

async function copyText(
  url: string,
  toast: ReturnType<typeof useToastManager>
) {
  try {
    await navigator.clipboard.writeText(url)
    toast.add({ title: "Report link copied", type: "success" })
  } catch {
    toast.add({
      title: "Couldn’t copy the link. Select it and copy it manually.",
      type: "error",
    })
  }
}

function statusPill(share: ReportShare) {
  if (share.status === "revoked") {
    return (
      <StatusPill tone="neutral" plain>
        Revoked
      </StatusPill>
    )
  }
  if (share.status === "expired") {
    return <StatusPill tone="warn">Expired</StatusPill>
  }
  return <StatusPill tone="ok">Active</StatusPill>
}

/**
 * "Share report" for one client (owners and admins; callers decide whether
 * to render it): pick how long the link lasts, create it, copy it. The link
 * is shown once — only its hash is kept — so the dialog says so and keeps it
 * on screen until closed. Below, the client's links with who made them,
 * when they expire, and how often they were opened, each revocable after a
 * confirmation.
 */
export function ShareReportButton({
  clientId,
  clientName,
  variant = "secondary",
}: {
  clientId: string
  clientName: string
  variant?: "default" | "secondary" | "ghost"
}) {
  const [open, setOpen] = useState(false)
  // Mounted on first use and kept, so it costs nothing on a page where it is
  // never opened and still animates closed once it has been.
  const [used, setUsed] = useState(false)
  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          setUsed(true)
          setOpen(true)
        }}
      >
        <Share2Icon aria-hidden strokeWidth={1.75} />
        Share report
      </Button>
      {used ? (
        <ShareReportDialog
          clientId={clientId}
          clientName={clientName}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  )
}

export function ShareReportDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
}: {
  clientId: string
  clientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToastManager()
  const ids = useId()
  const [days, setDays] = useState<ReportShareExpiryDays>(
    DEFAULT_REPORT_SHARE_EXPIRY_DAYS
  )
  const [created, setCreated] = useState<{
    url: string
    share: ReportShare
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => createReportShare(clientId, { expiresInDays: days }),
    onSuccess: async (result) => {
      setError(null)
      setCreated(result)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.clientReportShares(clientId),
      })
    },
    onError: (cause) => setError(describeActionError(cause)),
  })

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      // Shown once: closing the dialog is the end of it.
      setCreated(null)
      setError(null)
      setDays(DEFAULT_REPORT_SHARE_EXPIRY_DAYS)
    }
  }

  const expiryLabelId = `${ids}-expiry`
  const urlId = `${ids}-url`

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="wide" className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">
            Share {clientName}’s report
          </DialogTitle>
          <DialogDescription>
            A read-only link to this client’s totals: reviews, replies, ratings
            and Google profile figures. They don’t need an account.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {created ? (
            <section
              aria-labelledby={`${ids}-created`}
              className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface-alt p-4"
            >
              <h3
                id={`${ids}-created`}
                className="text-ui font-semibold text-ink"
              >
                Your link is ready
              </h3>
              <p className="text-ui text-ink">
                {shareWarning(clientName, created.share.expiresAt)}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor={urlId} className="sr-only">
                  Report link
                </label>
                <Input
                  id={urlId}
                  readOnly
                  value={created.url}
                  className="font-mono"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button onClick={() => void copyText(created.url, toast)}>
                  <CopyIcon aria-hidden strokeWidth={1.75} />
                  Copy link
                </Button>
              </div>
              <p className="text-caption text-ink-muted">
                Copy it now: it is shown only this once. If it is lost, revoke
                it below and create another.
              </p>
            </section>
          ) : (
            <div className="flex flex-col gap-3">
              <span
                id={expiryLabelId}
                className="text-ui font-semibold text-ink"
              >
                Link works for
              </span>
              <RadioGroup
                aria-labelledby={expiryLabelId}
                value={days}
                onValueChange={(value) =>
                  setDays(value as ReportShareExpiryDays)
                }
                className="flex-row flex-wrap gap-x-6"
              >
                {REPORT_SHARE_EXPIRY_OPTIONS.map((option) => (
                  <RadioGroupItem key={option.days} value={option.days}>
                    {option.label}
                  </RadioGroupItem>
                ))}
              </RadioGroup>
              <p className="text-ui text-ink">
                {shareWarning(clientName, inDays(days))}
              </p>
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>The link wasn’t created</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-end">
                <Button
                  pending={create.isPending}
                  pendingLabel="Creating…"
                  onClick={() => create.mutate()}
                >
                  Create link
                </Button>
              </div>
            </div>
          )}

          <ExistingLinks
            clientId={clientId}
            clientName={clientName}
            enabled={open}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function ExistingLinks({
  clientId,
  clientName,
  enabled,
}: {
  clientId: string
  clientName: string
  enabled: boolean
}) {
  const query = useReportShares(clientId, enabled)
  const queryClient = useQueryClient()
  const toast = useToastManager()
  const [confirming, setConfirming] = useState<ReportShare | null>(null)
  const headingId = useId()

  const revoke = useMutation({
    mutationFn: (shareId: string) => revokeReportShare(clientId, shareId),
    onSuccess: async () => {
      setConfirming(null)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.clientReportShares(clientId),
      })
      toast.add({
        title: "Link revoked",
        description: "Anyone who opens it now sees that it isn’t available.",
        type: "success",
      })
    },
    onError: (cause) =>
      toast.add({ title: describeActionError(cause), type: "error" }),
  })

  let body: React.ReactNode
  if (query.isPending) {
    body = <Skeleton aria-busy="true" className="h-16 w-full" />
  } else if (query.isError) {
    body = (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load this client’s links</AlertTitle>
        <AlertDescription>{describeActionError(query.error)}</AlertDescription>
        <AlertActions>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCwIcon aria-hidden />
            Try again
          </Button>
        </AlertActions>
      </Alert>
    )
  } else if (query.data.items.length === 0) {
    body = (
      <p className="text-caption text-ink-muted">
        No links yet for {clientName}.
      </p>
    )
  } else {
    body = (
      <ul className="flex flex-col divide-y divide-line rounded-(--np-radius-card) border border-line">
        {query.data.items.map((share) => (
          <li
            key={share.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-ui text-ink">
                {statusPill(share)}
                <span>
                  {share.status === "revoked" && share.revokedAt
                    ? `Revoked ${formatDay(share.revokedAt)}`
                    : `${share.status === "expired" ? "Expired" : "Expires"} ${formatDay(share.expiresAt)}`}
                </span>
              </span>
              <span className="text-caption text-ink-muted">
                Created by {share.createdByName ?? "a former teammate"}{" "}
                {formatDay(share.createdAt)} ·{" "}
                {share.viewCount === 0
                  ? "Not opened yet"
                  : `${formatNumber(share.viewCount)} ${share.viewCount === 1 ? "view" : "views"}, last ${formatRelativeTime(share.lastViewedAt ?? share.createdAt)}`}
              </span>
            </div>
            {share.status === "active" ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-ink"
                aria-label={`Revoke the link created ${formatDay(share.createdAt)}, expiring ${formatDay(share.expiresAt)}`}
                onClick={() => setConfirming(share)}
              >
                Revoke
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-ui font-semibold text-ink">
        Links for {clientName}
      </h3>
      {body}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Revoke this link?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops working straight away for anyone who has it. This can’t be
            undone; you can create a new link at any time.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep the link</Button>}
            />
            <Button
              variant="danger"
              pending={revoke.isPending}
              pendingLabel="Revoking…"
              onClick={() => confirming && revoke.mutate(confirming.id)}
            >
              Revoke link
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
