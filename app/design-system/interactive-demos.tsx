"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useState, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { RemovableChip } from "@/components/ui/chip"
import {
  Field,
  FieldCounter,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TagInput } from "@/components/ui/tag-input"
import { Textarea } from "@/components/ui/textarea"
import {
  ValidationSummary,
  type ValidationError,
} from "@/components/ui/validation-summary"

// Client-only specimens for the /design-system evidence page. Nothing here
// talks to an API: these demonstrate the primitives' own behaviour.

const subscribeNoop = () => () => {}

/** Flips next-themes between light and dark so both themes can be checked. */
export function ThemeToggleDemo() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  )
  const dark = mounted && resolvedTheme === "dark"
  return (
    <Button
      variant="secondary"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
      {dark ? "Switch to light theme" : "Switch to dark theme"}
    </Button>
  )
}

/** A button that shows its pending state for a moment, then returns. */
export function PendingButtonDemo() {
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant="secondary"
      pending={pending}
      pendingLabel="Publishing…"
      onClick={() => {
        setPending(true)
        window.setTimeout(() => setPending(false), 1600)
      }}
    >
      Try the pending state
    </Button>
  )
}

const LIMIT = 4096

export function CounterTextareaDemo() {
  const [text, setText] = useState(
    "Thank you, Anita — see you at the next curry night."
  )
  const bytes = new TextEncoder().encode(text).length
  return (
    <Field className="sm:col-span-2">
      <FieldLabel>Textarea with counter</FieldLabel>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <FieldCounter over={bytes > LIMIT}>
        {bytes.toLocaleString("en-GB")} / {LIMIT.toLocaleString("en-GB")} bytes
      </FieldCounter>
    </Field>
  )
}

export function TagInputDemo() {
  const [tags, setTags] = useState<string[]>(["Sunday roast", "Beer garden"])
  return (
    <Field>
      <FieldLabel>Labels</FieldLabel>
      <TagInput
        value={tags}
        onChange={setTags}
        max={6}
        placeholder="Type a label, then Enter"
        removeLabel={(tag) => `Remove label ${tag}`}
      />
    </Field>
  )
}

/** A two-field form whose submit fails validation to show the summary. */
export function ValidationDemo() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("bell@")
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [attempt, setAttempt] = useState(0)
  const errorFor = (id: string) =>
    errors.find((error) => error.fieldId === id)?.message

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const next: ValidationError[] = []
        if (!name.trim())
          next.push({
            fieldId: "ds-v-name",
            message: "Enter the location name.",
          })
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
          next.push({
            fieldId: "ds-v-email",
            message: "Enter a valid email address, like name@example.com.",
          })
        setErrors(next)
        setAttempt((count) => count + 1)
      }}
    >
      <ValidationSummary errors={errors} focusKey={attempt} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field error={errorFor("ds-v-name")}>
          <FieldLabel htmlFor="ds-v-name">Location name</FieldLabel>
          <Input
            id="ds-v-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError />
        </Field>
        <Field error={errorFor("ds-v-email")}>
          <FieldLabel htmlFor="ds-v-email">Contact email</FieldLabel>
          <Input
            id="ds-v-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError />
        </Field>
      </div>
      <div>
        <Button type="submit">Save profile</Button>
      </div>
    </form>
  )
}

/** An applied filter chip whose remove control really removes it. */
export function RemovableChipDemo() {
  const [shown, setShown] = useState(true)
  if (!shown)
    return (
      <Button variant="link" onClick={() => setShown(true)}>
        Restore the filter
      </Button>
    )
  return (
    <RemovableChip
      removeLabel="Remove filter The Bell"
      onRemove={() => setShown(false)}
    >
      The Bell
    </RemovableChip>
  )
}
