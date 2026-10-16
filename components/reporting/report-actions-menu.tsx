"use client"

import { EllipsisIcon, RefreshCwIcon, Share2Icon } from "lucide-react"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { ShareReportDialog } from "@/components/clients/share-report-dialog"
import { useRefreshGoogle } from "@/components/performance/refresh-google-button"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { healthLabel } from "@/lib/clients/health"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

/**
 * What "Share report" shares. One client in scope (or a business's one home
 * client) is shared directly; with every client in scope the menu offers
 * "Share a client’s report" and asks which first.
 */
export type ReportShareTarget =
  { kind: "client"; clientId: string; clientName: string } | { kind: "pick" }

/** Which Google refresh a report's menu starts. */
export type ReportRefresh = {
  kind: "performance" | "keywords"
  /**
   * The report is scoped to one client. The sync endpoints take no client
   * scope, so the press still refreshes every client: say so in the label.
   */
  scopedToClient?: boolean
  /** The press began: the tab starts following the refresh. */
  onStart?: () => void
  /** The request failed, so there is nothing to wait for. */
  onFailed?: () => void
}

type MenuProps = {
  /** Owners and admins only: callers leave it out for everyone else. */
  share?: ReportShareTarget | null
  /** Owners and admins only, and not while a report is paused. */
  refresh?: ReportRefresh | null
  /** More rows (links) a report adds of its own. */
  children?: React.ReactNode
  className?: string
}

/**
 * A report's actions in one overflow menu (a floating menu on a desk, an
 * action sheet on a phone): Share report and, on the Google tabs,
 * Refresh from Google. They used to be two buttons of their own, which cost
 * a report a row of chrome above its first figure and left no way to share
 * with every client in scope.
 *
 * Draws nothing when it has no action to offer. A refresh that fails says
 * why under the menu button, as it did under its own button.
 */
export function ReportActionsMenu({ refresh, ...props }: MenuProps) {
  return refresh ? (
    <MenuWithRefresh {...props} refresh={refresh} />
  ) : (
    <MenuView {...props} />
  )
}

function MenuWithRefresh({
  refresh,
  ...props
}: MenuProps & { refresh: ReportRefresh }) {
  const { run, pending, error } = useRefreshGoogle(refresh)
  return (
    <MenuView
      {...props}
      refresh={{ run, pending, scopedToClient: refresh.scopedToClient }}
      refreshError={error}
    />
  )
}

function MenuView({
  share,
  refresh,
  refreshError,
  children,
  className,
}: Omit<MenuProps, "refresh"> & {
  refresh?: {
    run: () => Promise<void>
    pending: boolean
    scopedToClient?: boolean
  } | null
  refreshError?: string | null
}) {
  const [picking, setPicking] = React.useState(false)
  // The dialog outlives the menu (a menu's rows unmount when it closes), and
  // is kept after it closes so it animates away.
  const [target, setTarget] = React.useState<{
    clientId: string
    clientName: string
  } | null>(null)
  const [shareOpen, setShareOpen] = React.useState(false)

  if (!share && !refresh && !children) return null

  function openShare(next: { clientId: string; clientName: string }) {
    setTarget(next)
    setShareOpen(true)
  }

  return (
    <div
      data-slot="report-actions"
      className={cn("flex flex-col items-end gap-1 print:hidden", className)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="More actions" />
          }
        >
          <EllipsisIcon aria-hidden strokeWidth={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" title="Report actions">
          {share ? (
            <DropdownMenuItem
              onClick={() => {
                if (share.kind === "client") openShare(share)
                else setPicking(true)
              }}
            >
              <Share2Icon aria-hidden strokeWidth={1.75} />
              {share.kind === "client"
                ? "Share report"
                : "Share a client’s report"}
            </DropdownMenuItem>
          ) : null}
          {refresh ? (
            <DropdownMenuItem
              disabled={refresh.pending}
              onClick={() => void refresh.run()}
            >
              <RefreshCwIcon aria-hidden strokeWidth={1.75} />
              {refresh.pending
                ? "Refreshing…"
                : refresh.scopedToClient
                  ? "Refresh all clients"
                  : "Refresh from Google"}
            </DropdownMenuItem>
          ) : null}
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {refreshError ? (
        <span
          role="alert"
          className="max-w-72 text-right text-caption text-danger-ink"
        >
          {refreshError}
        </span>
      ) : null}
      {share?.kind === "pick" ? (
        <ClientPickerSheet
          open={picking}
          onOpenChange={setPicking}
          onChoose={(client) => {
            setPicking(false)
            openShare({ clientId: client.id, clientName: client.name })
          }}
        />
      ) : null}
      {target ? (
        <ShareReportDialog
          clientId={target.clientId}
          clientName={target.clientName}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </div>
  )
}

/**
 * The first step of sharing with every client in scope: the scope sheet's
 * client rows (mark, name, health in words); choosing one goes on to the
 * share step for that client.
 */
function ClientPickerSheet({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (client: { id: string; name: string }) => void
}) {
  const clients = useClients({ enabled: open })
  const items = clients.data?.items ?? []
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent variant="inset">
        <SheetHeader>
          <SheetTitle>Share a client’s report</SheetTitle>
          <SheetDescription>
            Choose the client whose report to share.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {clients.isPending ? (
            <div aria-hidden className="flex flex-col gap-2">
              <Skeleton className="h-(--np-touch) w-full" />
              <Skeleton className="h-(--np-touch) w-full" />
            </div>
          ) : clients.isError ? (
            <p role="alert" className="text-ui text-danger-ink">
              We couldn’t load your clients. Close this and try again.
            </p>
          ) : items.length === 0 ? (
            <p className="text-ui text-ink-muted">There are no clients yet.</p>
          ) : (
            <OptionRowGroup applyOnChoose label="Clients">
              {items.map((client) => (
                <OptionRow
                  key={client.id}
                  indicator="chevron"
                  icon={
                    <ClientAvatar
                      name={client.name}
                      colour={client.colour}
                      size="xs"
                    />
                  }
                  label={<span className="block truncate">{client.name}</span>}
                  description={healthLabel(client.health)}
                  onClick={() => onChoose(client)}
                />
              ))}
            </OptionRowGroup>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
