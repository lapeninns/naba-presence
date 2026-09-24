"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import * as React from "react"

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
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { useSession } from "@/lib/queries/use-session"

/**
 * The agency's name, editable by an owner and read-only for everyone else.
 * Sign-up stores a placeholder ("<name>'s organisation"), so this is where
 * an agency gets its real name. Shared by Settings and the setup wizard's
 * agency step.
 *
 * A save writes the new name into the cached session (the sidebar reads it
 * from there) and refreshes server components, whose session still holds the
 * old one.
 */
export function AgencyNameForm() {
  const session = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const toast = useToastManager()
  const current = session.data?.session
  const saved = current?.organisationName ?? ""
  const isOwner = current?.role === "owner"
  const [draft, setDraft] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const value = draft ?? saved
  const dirty = draft !== null && draft.trim() !== saved

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
      toast.add({ title: "Agency name saved", type: "success" })
      router.refresh()
    },
    onError: (caught) => setError(describeActionError(caught)),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!dirty) return
    const parsed = organisationRenameSchema.safeParse({ name: value })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter your agency’s name.")
      return
    }
    rename.mutate(parsed.data.name)
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={onSubmit}
      noValidate
      aria-label="Agency name"
    >
      <Field error={error ?? undefined}>
        <FieldLabel>Agency name</FieldLabel>
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
            : "Only an owner can rename the agency."}
        </FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
      {isOwner ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="secondary"
            disabled={!dirty}
            pending={rename.isPending}
            pendingLabel="Saving…"
          >
            Save name
          </Button>
          {dirty ? (
            <span className="text-caption text-ink-muted" role="status">
              Unsaved change
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
