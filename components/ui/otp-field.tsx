"use client"

import { OTPField as OTPFieldPrimitive } from "@base-ui/react/otp-field"
import * as React from "react"

import { fieldControlProps, useFieldContext } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * A fixed-length one-time code: one box per character, built on Base UI's
 * OTP Field (which handles focus moving between boxes, backspace across
 * boxes, arrow keys, and pasting or autofilling a whole code into box one).
 *
 * Use it for codes whose length is known up front: a 6-digit MFA code, the
 * 5-digit PIN on a Google verification postcard. Do NOT use it for
 * variable-length codes. Google's verification contract allows a PIN of
 * 1–128 characters, so `components/locations/administration/
 * verification-pin-field.tsx` must keep a single text input. What it should
 * change: today it is `type="password"` with no keyboard hint, so phones show
 * the full keyboard and the person cannot see the digits they are copying
 * from paper. Migrate it to
 *
 *   <Input inputMode="numeric" autoComplete="one-time-code"
 *     autoCapitalize="none" autoCorrect="off" spellCheck={false} … />
 *
 * (drop `type="password"` unless masking is a hard requirement). Where a
 * flow knows the length (e.g. the postcard method), swap in
 * `<OtpField length={5} value={pin} onValueChange={setPin} />` inside the
 * same `<Field>`.
 *
 * Naming: a row of boxes is a `role="group"`, which `<label for>` cannot
 * name. Inside a Field the group takes the FieldLabel by `aria-labelledby`
 * (the same hand-over `useFieldTriggerProps` does), and the first box keeps
 * the Field id so the label's `for` still lands on it — clicking the label
 * focuses the first box. We deliberately don't call `useFieldTriggerProps`:
 * it would strip that `for`, and the first box *is* labelable. Outside a
 * Field, pass `aria-label` (or `aria-labelledby`) and it names the group and
 * the first box. Boxes after the first are announced "Digit 2 of 6".
 *
 * Sizing: boxes are the field height (44px on touch) and share the row
 * width, up to 48px each, so 6–8 boxes fit a 360px screen without wrapping.
 */
export type OtpFieldProps = Omit<
  React.ComponentProps<"div">,
  "onChange" | "defaultValue"
> & {
  /** Number of characters. Default 6. */
  length?: number
  /** `numeric` (default) opens the digit pad; `alphanumeric` allows A–Z. */
  mode?: "numeric" | "alphanumeric"
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Fires with the full code once every box is filled. */
  onComplete?: (value: string) => void
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  /** Form field name for the (hidden) combined value. */
  name?: string
  /** Id for the first box; later boxes derive `{id}-2`, `{id}-3`… */
  id?: string
  /** Mask the characters (password dots). Default false. */
  mask?: boolean
  autoComplete?: string
  /** Submit the owning form as soon as the code is complete. */
  autoSubmit?: boolean
  /** Extra classes for each box. */
  inputClassName?: string
}

function OtpField({
  length = 6,
  mode = "numeric",
  value,
  defaultValue,
  onValueChange,
  onComplete,
  disabled,
  readOnly,
  required,
  name,
  id,
  mask,
  autoComplete = "one-time-code",
  autoSubmit,
  className,
  inputClassName,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: OtpFieldProps) {
  const field = useFieldContext()
  const wiring = fieldControlProps(field)
  const groupId = React.useId()
  const invalid = ariaInvalid ?? wiring["aria-invalid"]
  // A caller-given name wins; otherwise the Field label names the group.
  const groupLabelledBy =
    ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId)
  const unit = mode === "numeric" ? "Digit" : "Character"

  return (
    <OTPFieldPrimitive.Root
      id={id ?? wiring.id}
      length={length}
      validationType={mode}
      inputMode={mode === "numeric" ? "numeric" : "text"}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next)}
      onValueComplete={(next) => onComplete?.(next)}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      name={name}
      mask={mask}
      autoComplete={autoComplete}
      autoSubmit={autoSubmit}
      aria-label={ariaLabel}
      aria-labelledby={groupLabelledBy}
      aria-describedby={ariaDescribedBy ?? wiring["aria-describedby"]}
      data-slot="otp-field"
      // The group needs its own id so the first box can borrow a standalone
      // `aria-label` through `aria-labelledby` (Base UI ignores `aria-label`
      // on box one, expecting a <label>).
      render={(rootProps) => <div {...rootProps} id={groupId} />}
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 sm:gap-2",
        className
      )}
      {...props}
    >
      {Array.from({ length }, (_, index) => (
        <OTPFieldPrimitive.Input
          key={index}
          aria-invalid={invalid || undefined}
          aria-label={
            index === 0 ? undefined : `${unit} ${index + 1} of ${length}`
          }
          // Inside a Field the first box is already named by `<label for>`.
          aria-labelledby={
            index === 0 && !(field && !ariaLabel && !ariaLabelledBy)
              ? (ariaLabelledBy ?? groupId)
              : undefined
          }
          autoCapitalize={mode === "numeric" ? "none" : "characters"}
          className={cn(
            // Field chrome, but centred large mono figures and a box that
            // shrinks with its row instead of a full-width bar.
            // design-exempt R1: a 20px glyph sized to the 48px digit box, fixed at every width
            "h-(--np-field-h) w-12 min-w-0 shrink rounded-(--np-radius-field) border border-line-strong bg-(--np-field-bg) p-0 text-center font-mono text-[20px] leading-none font-semibold text-ink tabular-nums outline-none",
            "transition-[border-color,box-shadow,background-color] duration-(--np-duration-fast) ease-spring-snappy hover:border-ink-muted",
            "focus:border-primary focus:shadow-(--np-field-ring)",
            "aria-invalid:border-danger-ink aria-invalid:shadow-(--np-field-ring-invalid)",
            "read-only:bg-surface-alt disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted",
            inputClassName
          )}
        />
      ))}
    </OTPFieldPrimitive.Root>
  )
}

/** Alias for listing-verification PIN flows that read better as "PIN". */
const PinField = OtpField

export { OtpField, PinField }
