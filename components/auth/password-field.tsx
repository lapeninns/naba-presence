"use client"

import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

function PasswordField({
  label,
  name,
  value,
  onValueChange,
  autoComplete,
  error,
  describedBy,
  autoFocus,
}: {
  label: string
  name: string
  value: string
  onValueChange: (value: string) => void
  autoComplete: "current-password" | "new-password"
  error?: string
  describedBy?: React.ReactNode
  autoFocus?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  return (
    <Field error={error}>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Input
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="pr-10"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyUp={(event) =>
            setCapsLock(event.getModifierState?.("CapsLock") ?? false)
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          accessibleNameFromChildren
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {/* Accessible name comes from this visually-hidden text, not
              aria-label: Playwright's getByLabel() (and some other
              label-locator tooling) treats any element's own aria-label
              attribute as a labelled form control candidate, which made
              this toggle collide with getByLabel("Password") on the
              adjacent input (both contain the substring "password").
              Plain text content isn't scanned that way, so this keeps the
              same accessible name and getByRole(button, name) lookups
              while removing the ambiguity. */}
          <span className="sr-only">{visible ? "Hide password" : "Show password"}</span>
        </Button>
      </div>
      {capsLock || describedBy ? (
        <FieldDescription>
          {capsLock ? <span className="block">Caps Lock is on.</span> : null}
          {capsLock && describedBy ? " " : null}
          {describedBy}
        </FieldDescription>
      ) : null}
      <FieldError />
    </Field>
  )
}

export { PasswordField }
