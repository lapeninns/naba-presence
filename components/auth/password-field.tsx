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
  labelAside,
}: {
  label: string
  name: string
  value: string
  onValueChange: (value: string) => void
  autoComplete: "current-password" | "new-password"
  error?: string
  describedBy?: React.ReactNode
  autoFocus?: boolean
  /** A route out beside the label, e.g. "Forgot password?". */
  labelAside?: React.ReactNode
}) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  return (
    <Field error={error}>
      {labelAside ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <FieldLabel>{label}</FieldLabel>
          {labelAside}
        </div>
      ) : (
        <FieldLabel>{label}</FieldLabel>
      )}
      <div className="relative">
        <Input
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="pr-12"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyUp={(event) =>
            setCapsLock(event.getModifierState?.("CapsLock") ?? false)
          }
        />
        <span className="absolute inset-y-0 right-[3px] flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 rounded-md text-ink-muted hover:text-ink pointer-coarse:size-10"
            accessibleNameFromChildren
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? (
              <EyeOff strokeWidth={1.75} aria-hidden />
            ) : (
              <Eye strokeWidth={1.75} aria-hidden />
            )}
            {/* Accessible name comes from this visually-hidden text, not
                aria-label: Playwright's getByLabel() (and some other
                label-locator tooling) treats any element's own aria-label
                attribute as a labelled form control candidate, which made
                this toggle collide with getByLabel("Password") on the
                adjacent input (both contain the substring "password").
                Plain text content isn't scanned that way, so this keeps the
                same accessible name while removing the ambiguity. */}
            <span className="sr-only">
              {visible ? "Hide password" : "Show password"}
            </span>
          </Button>
        </span>
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
