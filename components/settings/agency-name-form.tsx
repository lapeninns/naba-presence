"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import * as React from "react"

import { DiscardDialog } from "@/components/editors/discard-dialog"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useToastManager } from "@/components/ui/toast"
import { renameOrganisation, type SessionResponse } from "@/lib/api/session"
import {
  ORGANISATION_NAME_MAX,
  organisationRenameSchema,
} from "@/lib/contracts/session"
import { useDraftKey } from "@/lib/editors/use-draft-key"
import { describeActionError } from "@/lib/errors/action-errors"
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes"
import { queryKeys } from "@/lib/queries/keys"
import { useSession } from "@/lib/queries/use-session"
import { workspaceTerms, type WorkspaceTerms } from "@/lib/workspace/terms"

/**
 * Why `value` can't be saved as the account's name, in the workspace's own
 * words, or null when it can. The contract's messages say "agency"; a
 * business hears its own word. Shared with the Reply policy page, which
 * saves the name from its save bar (policy-form.tsx).
 */
export function organisationNameProblem(
  value: string,
  terms: WorkspaceTerms
): string | null {
  const parsed = organisationRenameSchema.safeParse({ name: value })
  if (parsed.success) return null
  if (terms.org === "Agency") {
    return parsed.error.issues[0]?.message ?? "Enter your agency’s name."
  }
  return value.trim().length === 0
    ? "Enter your business’s name."
    : `Keep the name to ${ORGANISATION_NAME_MAX} characters or fewer.`
}

/**
 * The account's name ("Business name" in business mode, "Agency name" in
 * agency mode), editable by an owner and read-only for everyone else.
 * Sign-up stores a placeholder ("<name>'s organisation"), so this is where
 * an agency gets its real name. Shared by Settings and the setup wizard's
 * agency step. (Settings saves the name with the Reply policy instead, on
 * the page's one save bar: policy-form.tsx.)
 *
 * A save writes the new name into the cached session (the sidebar reads it
 * from there) and refreshes server components, whose session still holds the
 * old one.
 *
 * In the wizard the name is its own record, so it saves with its own button:
 * the button at the trailing edge, "Unsaved change" or the error just before
 * it, and a leave guard so an unsaved name is never dropped by following a
 * link.
 */
export function AgencyNameForm() {
  const session = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const toast = useToastManager()
  const current = session.data?.session
  const terms = workspaceTerms(current?.workspaceMode ?? "agency")
  const saved = current?.organisationName ?? ""
  const isOwner = current?.role === "owner"
  const [draft, setDraft] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const value = draft ?? saved
  const dirty = draft !== null && draft.trim() !== saved
  // A reload or closed tab warns and an in-app link or the back button asks
  // first. Nothing offers a name back later, so it is not stashed.
  const draftKey = useDraftKey({ resource: "agency-name", schemaVersion: 1 })
  const unsaved = useUnsavedChanges({
    scope: draftKey,
    isDirty: isOwner && dirty,
  })

  const rename = useMutation({
    mutationFn: (name: string) => renameOrganisation(name),
    onSuccess: (organisation) => {
      queryClient.setQueryData<SessionResponse>(queryKeys.session, (old) =>
        old?.session
          ? {
              session: { ...old.session, organisationName: organisation.name },
            }
          : old
      )
      void queryClient.invalidateQueries({ queryKey: ["organisations"] })
      setDraft(null)
      setError(null)
      toast.add({ title: `${terms.orgName} saved`, type: "success" })
      router.refresh()
    },
    onError: (caught) => setError(describeActionError(caught)),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!dirty) return
    const problem = organisationNameProblem(value, terms)
    if (problem) {
      setError(problem)
      return
    }
    rename.mutate(value.trim())
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={onSubmit}
      noValidate
      aria-label={terms.orgName}
    >
      <Field measure="short" error={error ?? undefined}>
        <FieldLabel>{terms.orgName}</FieldLabel>
        <Input
          value={value}
          readOnly={!isOwner}
          maxLength={ORGANISATION_NAME_MAX}
          autoComplete="organization"
          onChange={(event) => {
            setError(null)
            setDraft(event.target.value)
          }}
        />
        <FieldDescription>
          {isOwner
            ? "What your team sees in the sidebar and what invitations say they are joining."
            : `Only an owner can rename the ${terms.orgLower}.`}
        </FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
      {isOwner ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-ui text-ink-muted" role="status">
            {dirty && !rename.isPending ? "Unsaved change" : ""}
          </span>
          <Button
            type="submit"
            variant="secondary"
            disabled={!dirty}
            pending={rename.isPending}
            pendingLabel="Saving…"
          >
            Save name
          </Button>
        </div>
      ) : null}
      <DiscardDialog
        {...unsaved.leavePrompt}
        title="Leave without saving the name?"
        confirmLabel="Leave and discard"
        announce={false}
        description={`The new ${terms.orgName.toLowerCase()} isn’t saved. Leaving throws it away; the current name stays.`}
      />
    </form>
  )
}
