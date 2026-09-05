"use client"

import { CheckIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { describeActionError } from "@/lib/errors/action-errors"
import { useClientMutations } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

const COLOURS = [
  "#7A4E3B",
  "#3F5E52",
  "#4A4C7A",
  "#6B4A6B",
  "#3E5B70",
  "#6E5A2E",
]

/**
 * Creating a client is deliberately three fields.
 *
 * Everything else about a client — its Google account, its locations, who can
 * see it — is decided in the setup flow that follows, where each answer has
 * the context to make sense. Asking for all of it up front would put a
 * fourteen-field form between the operator and a working client.
 */
function NewClientForm() {
  const router = useRouter()
  const { create } = useClientMutations()
  const [name, setName] = React.useState("")
  const [colour, setColour] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState("")

  const error = create.error ? describeActionError(create.error) : null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const result = await create.mutateAsync({
      name: name.trim(),
      ...(colour ? { colour } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    })
    // Straight into setup: a client with no Google connection does nothing,
    // and the next thing anyone wants is its reviews flowing.
    router.push(`/setup?client=${result.client.id}&step=connect`)
  }

  return (
    <form onSubmit={submit} className="max-w-lg">
      <Card>
        <CardContent className="flex flex-col gap-(--np-gap-section)">
          <Field>
            <FieldLabel>Client name</FieldLabel>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Old Crown Group"
              required
              maxLength={120}
              autoFocus
            />
            <FieldDescription>
              The business as you and your team refer to it, not necessarily its
              Google listing name.
            </FieldDescription>
          </Field>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-ui font-medium text-ink">Colour</legend>
            <p className="text-caption text-ink-muted">
              Used on the client&rsquo;s mark so it is recognisable in a long
              list.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {COLOURS.map((option) => {
                const selected = colour === option
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setColour(selected ? null : option)}
                    aria-pressed={selected}
                    aria-label={`Use colour ${option}`}
                    style={{ backgroundColor: option }}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-(--np-radius-control) text-primary-foreground focus-halo transition duration-(--np-duration-fast) ease-spring-snappy active:scale-[0.96]",
                      selected &&
                        "[box-shadow:0_0_0_2px_var(--np-surface),0_0_0_4px_var(--np-accent)]"
                    )}
                  >
                    {selected ? (
                      <CheckIcon
                        aria-hidden
                        className="size-4"
                        strokeWidth={2}
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <Field>
            <FieldLabel>Notes (optional)</FieldLabel>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Anything your team should know before replying for this client."
            />
          </Field>

          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? "Creating…" : "Create client"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

export { NewClientForm }
