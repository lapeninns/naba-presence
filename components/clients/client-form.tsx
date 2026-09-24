"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"

import { ClientColourField } from "@/components/clients/client-colour-field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardFooter } from "@/components/ui/card"
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
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { useClientMutations } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

const NOTES_MAX = 2000

/**
 * Creating a client is deliberately three fields.
 *
 * Everything else about a client — its Google account, its listings, who can
 * see it — is decided in the setup flow that follows, where each answer has
 * the context to make sense. Asking for all of it up front would put a
 * fourteen-field form between the operator and a working client.
 */
function NewClientForm() {
  const router = useRouter()
  const toast = useToastManager()
  const { create } = useClientMutations()
  const [name, setName] = React.useState("")
  const [colour, setColour] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState("")
  const [nameError, setNameError] = React.useState<string | null>(null)
  const nameRef = React.useRef<HTMLInputElement>(null)

  const serverError = create.error ? describeActionError(create.error) : null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
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
        description: "Next: connect its Google account.",
      })
      // Straight into setup: a client with no Google connection does nothing,
      // and the next thing anyone wants is its reviews flowing.
      router.push(`/setup?client=${result.client.id}&step=connect`)
    } catch {
      // The alert below says what went wrong; the values stay in the form.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} noValidate aria-label="New client">
        <Card flush>
          <div className="flex flex-col gap-5 p-(--np-card-pad)">
            {serverError ? (
              <Alert variant="destructive">
                <AlertTitle>The client wasn’t created</AlertTitle>
                <AlertDescription>
                  {serverError} Nothing was added, and your details are still
                  here.
                </AlertDescription>
              </Alert>
            ) : null}

            <Field error={nameError ?? undefined}>
              <FieldLabel>Client name</FieldLabel>
              <Input
                ref={nameRef}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (nameError && event.target.value.trim()) setNameError(null)
                }}
                placeholder="Old Crown Group"
                required
                maxLength={120}
                autoComplete="off"
                autoFocus
              />
              <FieldDescription>
                The business as you and your team refer to it, not necessarily
                its Google listing name.
              </FieldDescription>
              <FieldError />
            </Field>

            <ClientColourField value={colour} onChange={setColour} />

            <Field>
              <FieldLabel optional>Notes</FieldLabel>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                maxLength={NOTES_MAX}
                placeholder="Anything your team should know before replying for this client."
              />
              <FieldCounter count={notes.length} max={NOTES_MAX}>
                {formatNumber(notes.length)} / {formatNumber(NOTES_MAX)}
              </FieldCounter>
            </Field>
          </div>
          <CardFooter bar>
            <span role="status" className="text-caption text-ink-muted">
              {create.isPending
                ? "Creating the client…"
                : "Creating the client doesn’t touch Google."}
            </span>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/clients"
                className={cn(buttonVariants({ variant: "ghost" }))}
              >
                Cancel
              </Link>
              <Button
                type="submit"
                pending={create.isPending}
                pendingLabel="Creating…"
              >
                Create client
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>

      <section
        aria-labelledby="new-client-next"
        className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface-alt p-(--np-card-pad)"
      >
        <h2 id="new-client-next" className="text-body font-semibold text-ink">
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
              "Pick the locations that belong to this client. Their reviews start arriving once linked.",
            ],
            [
              "Import past reviews.",
              "Runs in the background. You can carry on while it works.",
            ],
          ].map(([title, detail], index) => (
            <li
              key={title}
              className="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5"
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-[22px] place-items-center rounded-full border-[1.5px] font-mono text-[11px] tabular-nums",
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
    </div>
  )
}

export { NewClientForm }
