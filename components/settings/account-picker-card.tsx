"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import type { GoogleAccount } from "@/lib/api/google-accounts"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { describeActionError } from "@/lib/errors/action-errors"

export function AccountPickerCard() {
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  // A connection picker (Select bound to the user's choice) lands once an org can hold
  // more than one Google connection at once; today deriveAutoSelection's single-connection
  // path resolves the working connection on its own, and Task 9's import card reuses the
  // same rule against the shared Query cache.
  const resolvedConnectionId = deriveAutoSelection({
    connections: connections.map((connection) => ({ id: connection.id, status: connection.status })),
    accounts: [],
    selectedConnectionId: null,
    selectedAccountName: null,
  }).connectionId

  const accounts = useGoogleAccounts(resolvedConnectionId)
  const toast = useToastManager()

  const saveStatus = accounts.save.status
  const previousSaveStatus = useRef(saveStatus)
  useEffect(() => {
    if (previousSaveStatus.current === saveStatus) return
    previousSaveStatus.current = saveStatus
    if (saveStatus === "success") toast.add({ title: "Accounts updated", type: "success" })
    if (saveStatus === "error") toast.add({ title: describeActionError(accounts.save.error), type: "error" })
  }, [saveStatus, accounts.save.error, toast])

  if (accounts.query.isPending) {
    return <Skeleton className="h-32 w-full" />
  }
  if (accounts.query.isError) {
    return (
      <Empty
        title="We couldn’t load your Google accounts"
        description={describeActionError(accounts.query.error)}
        action={<Button variant="outline" onClick={() => accounts.query.refetch()}>Try again</Button>}
      />
    )
  }

  const rows = accounts.query.data.accounts
  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Google accounts</h2>
        <Empty title="No Google accounts found" description="This connection has no Business Profile accounts to manage." />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Google accounts</h2>
      {/* Remounting on a fresh fetch (i.e. after a successful save invalidates and
          refetches) re-derives the checked set from the server truth without an effect
          that mirrors query data into local state. */}
      <AccountPickerTable key={accounts.query.dataUpdatedAt} rows={rows} save={accounts.save} />
    </section>
  )
}

function AccountPickerTable({
  rows,
  save,
}: {
  rows: GoogleAccount[]
  save: ReturnType<typeof useGoogleAccounts>["save"]
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(rows.filter((account) => account.isActive).map((account) => account.id))
  )

  const toggle = (id: string) => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            <TableHead>Use</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((account) => (
            <TableRow key={account.id}>
              <TableCell>
                <Checkbox
                  checked={checked.has(account.id)}
                  aria-label={`Use ${account.accountName}`}
                  onCheckedChange={() => toggle(account.id)}
                />
              </TableCell>
              <TableCell className="font-medium">{account.accountName}</TableCell>
              <TableCell className="text-muted-foreground">{account.role ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div>
        <Button disabled={save.isPending} onClick={() => save.mutate([...checked])}>
          {save.isPending ? "Saving…" : "Save accounts"}
        </Button>
      </div>
    </>
  )
}
