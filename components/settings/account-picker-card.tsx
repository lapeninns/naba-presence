"use client"

import { useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { FormError } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { useOutcomeToast } from "@/components/ui/toast"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import type { GoogleAccount } from "@/lib/api/google-accounts"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { describeActionError } from "@/lib/errors/action-errors"

// Google's account roles in people's words. An unknown role is sentence-cased
// rather than shown as an enum; a missing one shows nothing.
const ROLE_LABEL: Record<string, string> = {
  PRIMARY_OWNER: "Primary owner",
  OWNER: "Owner",
  MANAGER: "Manager",
  SITE_MANAGER: "Site manager",
}

function roleLabel(role: string | null | undefined): string | undefined {
  if (!role) return undefined
  const known = ROLE_LABEL[role]
  if (known) return known
  const words = role.toLowerCase().replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Which Business Profile accounts the working Google login should manage.
 *
 * A Mac-style list: one row per account with a leading checkbox, the
 * account's role in muted text on the right, and an explicit Save — the
 * selection is a set, and saving half of one would be worse than saving none.
 */
export function AccountPickerCard({
  clientId,
  connectionId,
  saveBeforeContinueRef,
  onChooseAnotherLogin,
}: {
  /** Setup: save only among this client's logins. */
  clientId?: string
  /** Setup: the login the client connected, instead of the derived one. */
  connectionId?: string | null
  /**
   * Setup: filled with a function the wizard's Continue calls first. It saves
   * a changed selection and resolves false when that save fails (the error
   * shows inline), so Continue never needs a separate Save click.
   */
  saveBeforeContinueRef?: React.RefObject<(() => Promise<boolean>) | null>
  /**
   * Setup: the way out when this login has no accounts (back to Connect to
   * pick another). Without it the empty state offers no button.
   */
  onChooseAnotherLogin?: () => void
} = {}) {
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  // A connection picker (Select bound to the user's choice) lands once an org can hold
  // more than one Google connection at once; today deriveAutoSelection's single-connection
  // path resolves the working connection on its own, and Task 9's import card reuses the
  // same rule against the shared Query cache.
  const derivedConnectionId = deriveAutoSelection({
    connections: connections.map((connection) => ({
      id: connection.id,
      status: connection.status,
    })),
    accounts: [],
    selectedConnectionId: null,
    selectedAccountName: null,
  }).connectionId
  const resolvedConnectionId = connectionId ?? derivedConnectionId

  const accounts = useGoogleAccounts(resolvedConnectionId, { clientId })
  const toast = useOutcomeToast()
  const headingId = useId()

  // Success is a toast; a failure stays inline beside the Save button (see
  // AccountPickerTable), where it is still there when the operator looks.
  const saveStatus = accounts.save.status
  const previousSaveStatus = useRef(saveStatus)
  useEffect(() => {
    if (previousSaveStatus.current === saveStatus) return
    previousSaveStatus.current = saveStatus
    if (saveStatus === "success") toast.show({ title: "Accounts updated" })
  }, [saveStatus, toast])

  if (accounts.query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
      </div>
    )
  }
  if (accounts.query.isError) {
    return (
      // A failed load reads as a failure (never plain `empty`) and is
      // announced once; Try again sits outside the alert. Each retry is one
      // rate-limited discovery, so it shows it is running.
      <Empty
        variant="error"
        role="alert"
        title="We couldn’t load your Google accounts"
        description={`${describeActionError(accounts.query.error)} Nothing was changed.`}
        actions={
          <Button
            variant="secondary"
            pending={accounts.query.isFetching}
            pendingLabel="Trying again…"
            onClick={() => void accounts.query.refetch()}
          >
            Try again
          </Button>
        }
      />
    )
  }

  // Only accounts this login reaches: a save is scoped to it, so a row from
  // another login could be ticked here but never switched on.
  const rows = accounts.query.data.accounts.filter(
    (account) =>
      !resolvedConnectionId ||
      !account.googleConnectionId ||
      account.googleConnectionId === resolvedConnectionId
  )
  if (rows.length === 0) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Google accounts
        </h2>
        <Empty
          title="This Google login has no Business Profile accounts"
          description="Google didn’t list any accounts for it. Go back and connect the Google account that manages this profile."
          action={
            onChooseAnotherLogin ? (
              <Button variant="secondary" onClick={onChooseAnotherLogin}>
                Use another Google login
              </Button>
            ) : undefined
          }
        />
      </section>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-title font-semibold text-ink">
        Google accounts
      </h2>
      {/* Remounting on a fresh fetch (i.e. after a successful save invalidates and
          refetches) re-derives the checked set from the server truth without an effect
          that mirrors query data into local state. */}
      <AccountPickerTable
        key={accounts.query.dataUpdatedAt}
        rows={rows}
        save={accounts.save}
        saveBeforeContinueRef={saveBeforeContinueRef}
      />
    </section>
  )
}

function AccountPickerTable({
  rows,
  save,
  saveBeforeContinueRef,
}: {
  rows: GoogleAccount[]
  save: ReturnType<typeof useGoogleAccounts>["save"]
  saveBeforeContinueRef?: React.RefObject<(() => Promise<boolean>) | null>
}) {
  const [saved] = useState<Set<string>>(
    () =>
      new Set(
        rows.filter((account) => account.isActive).map((account) => account.id)
      )
  )
  const [checked, setChecked] = useState<Set<string>>(() => new Set(saved))
  const dirty =
    checked.size !== saved.size || [...checked].some((id) => !saved.has(id))
  const errorId = useId()

  // Kept current every render so Continue always saves the latest ticks.
  const saveIfChanged = async () => {
    if (!dirty) return true
    try {
      await save.mutateAsync([...checked])
      return true
    } catch {
      // The mutation holds the error; the inline alert below reads it.
      return false
    }
  }
  // Re-registered after every render so Continue saves the latest ticks.
  useEffect(() => {
    if (!saveBeforeContinueRef) return
    saveBeforeContinueRef.current = saveIfChanged
    return () => {
      saveBeforeContinueRef.current = null
    }
  })

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
      <ul
        aria-label="Business Profile accounts"
        className="divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-card) bg-surface"
      >
        {rows.map((account) => (
          // The whole row is the checkbox's label (the primitive's own
          // 44px selection row), so tapping the account name ticks it, not
          // only the 18px box. The role, when Google gives one, is the
          // description.
          <li key={account.id} className="px-(--np-card-pad)">
            <Checkbox
              checked={checked.has(account.id)}
              onCheckedChange={() => toggle(account.id)}
              label={account.accountName}
              description={roleLabel(account.role)}
              labelClassName="w-full break-words py-3 desk:py-2"
            />
          </li>
        ))}
      </ul>
      {save.isError ? (
        <FormError id={errorId}>
          Your account choice wasn’t saved. {describeActionError(save.error)}
        </FormError>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {dirty && saveBeforeContinueRef ? (
          <span className="text-ui text-ink-muted" role="status">
            Continue saves your choice.
          </span>
        ) : null}
        <Button
          variant={saveBeforeContinueRef ? "secondary" : undefined}
          disabled={save.isPending}
          aria-describedby={save.isError ? errorId : undefined}
          onClick={() => save.mutate([...checked])}
        >
          {save.isPending ? "Saving…" : "Save accounts"}
        </Button>
      </div>
    </>
  )
}
