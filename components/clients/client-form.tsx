"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"

import { ClientColourField } from "@/components/clients/client-colour-field"
import { DiscardDialog } from "@/components/editors/discard-dialog"
import { ActionBar } from "@/components/ui/action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Field,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  describeActionError,
  isUnconfirmedFailure,
} from "@/lib/errors/action-errors"
import { useDraftKey } from "@/lib/editors/use-draft-key"
import { formatNumber } from "@/lib/format"
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes"
import { useClientMutations } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"
import { LISTING_TERMS } from "@/lib/workspace/terms"

const NOTES_MAX = 2000

/**
 * Creating a client is deliberately three fields.
 *
 * Everything else about a client — its Google account, its listings, who can
 * see it — is decided in the setup flow that follows, where each answer has
 * the context to make sense. Asking for all of it up front would put a
 * fourteen-field form between the operator and a working client.
 */
function NewClientForm({ listingId }: { listingId?: string }) {
  const router = useRouter()
  const returnPath = listingId
    ? `/listings/${encodeURIComponent(listingId)}`
    : null
  const toast = useToastManager()
  const { create } = useClientMutations()
  const [name, setName] = React.useState("")
  const [colour, setColour] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState("")
  const [nameError, setNameError] = React.useState<string | null>(null)
  const nameRef = React.useRef<HTMLInputElement>(null)

  // Anything typed or picked is unsaved until the client is created: a
  // reload warns, and Cancel, another link or the back button ask first.
  // Nothing offers the draft back later, so it is not stashed.
  const draftKey = useDraftKey({ resource: "client-new", schemaVersion: 1 })
  const unsaved = useUnsavedChanges({
    scope: draftKey,
    isDirty:
      !create.isSuccess &&
      (name.trim() !== "" || colour !== null || notes.trim() !== ""),
  })

  // A taken name is the name field's problem, so it is said there, with the
  // fix (the unique check counts archived clients too), not as a page alert
  // telling them to refresh. It clears as soon as the name is edited.
  const nameTaken = isNameTaken(create.error)
  const takenName = create.variables?.name ?? name.trim()
  const nameFieldError =
    nameError ??
    (nameTaken
      ? `There’s already a client called “${takenName}”. Archived clients count too, so check Clients › Archived, or use a different name.`
      : undefined)
  // Everything else is the alert. A dropped connection or an unanswered
  // server error may still have created the client, so that one never says
  // "nothing was added"; and creating a client never touches Google, so a
  // server failure is described here rather than in the shared copy that
  // names Google.
  const serverAlert =
    create.error && !nameTaken
      ? isUnconfirmedFailure(create.error)
        ? {
            title: "We couldn’t confirm the client was created",
            body: "NabaPresence didn’t answer, so it may have been added. Check Clients before trying again. Your details are still here.",
          }
        : {
            title: "The client wasn’t created",
            body: `${
              create.error instanceof ApiClientError &&
              create.error.status >= 500
                ? "NabaPresence couldn’t save it just now. Try again in a moment."
                : describeActionError(create.error)
            } Nothing was added, and your details are still here.`,
          }
      : null
  // Created, and on the way to the next page: the button stays pending so a
  // second tap cannot post the same client again.
  const busy = create.isPending || create.isSuccess

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError("Give the client a name.")
      nameRef.current?.focus()
      return
    }
    try {
      const result = await create.mutateAsync({
        name: trimmed,
        ...(colour ? { colour } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      toast.add({
        type: "success",
        title: `${result.client.name} created`,
        description: returnPath
          ? "Return to the listing and choose this client to file it."
          : "Next: connect its Google account.",
      })
      router.push(
        returnPath ?? `/setup?client=${result.client.id}&step=connect`
      )
    } catch (error) {
      // The alert (or, for a taken name, the field) says what went wrong;
      // the values stay in the form.
      if (isNameTaken(error)) nameRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={submit}
        noValidate
        aria-label="New client"
        className="flex flex-col gap-4"
      >
        <Card flush>
          <div className="flex flex-col gap-5 p-(--np-card-pad)">
            {serverAlert ? (
              <Alert variant="destructive">
                <AlertTitle>{serverAlert.title}</AlertTitle>
                <AlertDescription>{serverAlert.body}</AlertDescription>
              </Alert>
            ) : null}

            <Field error={nameFieldError}>
              <FieldLabel>Client name</FieldLabel>
              <Input
                ref={nameRef}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (nameError && event.target.value.trim()) setNameError(null)
                  if (nameTaken) create.reset()
                }}
                placeholder="Old Crown Group"
                required
                maxLength={120}
                // The business's name for the team, not the person's own
                // organisation, so the browser should not offer autofill.
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="go"
                spellCheck={false}
                autoFocus
              />
              <FieldDescription>
                The business as you and your team refer to it, not necessarily
                its Google listing name.
              </FieldDescription>
              <FieldError />
            </Field>

            <ClientColourField
              value={colour}
              onChange={setColour}
              name={name}
            />

            <Field>
              <FieldLabel optional>Notes</FieldLabel>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                maxLength={NOTES_MAX}
                autoCapitalize="sentences"
                placeholder="Anything your team should know before replying for this client."
              />
              <FieldCounter count={notes.length} max={NOTES_MAX}>
                {formatNumber(notes.length)} / {formatNumber(NOTES_MAX)}
              </FieldCounter>
            </Field>
          </div>
        </Card>
        {/* Docked to a phone's bottom edge (the tab bar steps aside and the
            bar rides the keyboard, so Create client is never behind it);
            stuck to the foot of the form on a desk. */}
        <ActionBar
          dock
          tone="surface"
          offset="md:bottom-3"
          label="Create client"
          status={
            <span>
              {busy ? "Creating the client…" : "Nothing is sent to Google."}
            </span>
          }
          actions={
            <>
              <Link
                href={returnPath ?? "/clients"}
                className={cn(buttonVariants({ variant: "ghost" }))}
              >
                Cancel
              </Link>
              <Button type="submit" pending={busy} pendingLabel="Creating…">
                Create client
              </Button>
            </>
          }
        />
        <DiscardDialog
          {...unsaved.leavePrompt}
          title="Leave without creating the client?"
          confirmLabel="Leave and discard"
          announce={false}
          description="This client hasn’t been created yet. Leaving throws away what you’ve typed."
        />
      </form>

      {returnPath ? (
        <p className="text-ui text-ink-muted">
          After creating the client, you’ll return to the listing. Choose the
          new client under “File under…” to assign it. Creating a client does
          not move any listings.
        </p>
      ) : (
        <Card className="bg-surface-alt">
          <section
            aria-labelledby="new-client-next"
            className="flex flex-col gap-3 px-(--card-spacing)"
          >
            <h2
              id="new-client-next"
              className="text-body font-semibold text-ink"
            >
              What happens next
            </h2>
            <ol className="flex flex-col gap-2.5 text-ui">
              {[
                [
                  "Connect Google.",
                  "Sign in to the Google account that manages this client’s Business Profile, or reuse one you’ve already connected.",
                ],
                [
                  "Link its listings.",
                  `Pick the ${LISTING_TERMS.placePlural} that belong to this client. Their reviews start arriving once linked.`,
                ],
                [
                  "Import past reviews.",
                  "Runs in the background. You can carry on while it works.",
                ],
              ].map(([title, detail], index) => (
                <li key={title} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] text-caption font-semibold tabular-nums",
                      index === 0
                        ? "border-primary bg-accent-tint text-accent-ink"
                        : "border-line-strong text-ink-muted"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <strong className="font-semibold text-ink">{title}</strong>{" "}
                    <span className="text-ink-muted">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </Card>
      )}
    </div>
  )
}

function isNameTaken(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "client_name_taken"
}

export { NewClientForm }
