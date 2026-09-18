"use client"

import { SearchIcon, XCircleIcon } from "lucide-react"
import * as React from "react"

import {
  fieldChromeClassName,
  fieldControlProps,
  useFieldContext,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

export type InputProps = React.ComponentProps<"input"> & {
  /**
   * `search` renders the capsule search field: grey fill, a leading magnifier
   * and a clear button once there is text. `type="search"` selects it too, so
   * existing search boxes pick up the look without a prop change.
   */
  variant?: "default" | "search"
  /** Called after the clear button empties the field. */
  onClear?: () => void
  /** Extra classes for the inner `<input>` of the search variant. */
  inputClassName?: string
}

function Input({
  className,
  type,
  variant,
  onClear,
  inputClassName,
  ...props
}: InputProps) {
  const field = useFieldContext()
  const isSearch =
    variant === "search" || (variant === undefined && type === "search")

  if (isSearch) {
    return (
      <SearchInput
        className={className}
        inputClassName={inputClassName}
        onClear={onClear}
        {...fieldControlProps(field)}
        {...props}
      />
    )
  }

  return (
    <input
      type={type ?? "text"}
      data-slot="input"
      className={cn(
        fieldChromeClassName,
        "h-(--np-field-h) w-full px-3",
        className
      )}
      {...fieldControlProps(field)}
      {...props}
    />
  )
}

/**
 * The capsule search field. The wrapper is the control — `className` sizes
 * it — and the native `<input>` inside is transparent. Clearing goes through
 * the native value setter plus an `input` event so a controlled `onChange`
 * sees it exactly like typing, and focus returns to the field.
 */
function SearchInput({
  className,
  inputClassName,
  onClear,
  ref,
  value,
  defaultValue,
  onChange,
  disabled,
  ...props
}: Omit<InputProps, "variant" | "type">) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [uncontrolledHasValue, setUncontrolledHasValue] = React.useState(
    defaultValue !== undefined &&
      defaultValue !== null &&
      String(defaultValue).length > 0
  )
  const isControlled = value !== undefined
  const hasValue = isControlled
    ? value !== null && String(value).length > 0
    : uncontrolledHasValue

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  const clear = () => {
    const el = inputRef.current
    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set
    setter?.call(el, "")
    el.dispatchEvent(new Event("input", { bubbles: true }))
    setUncontrolledHasValue(false)
    el.focus()
    onClear?.()
  }

  return (
    <div
      data-slot="input-search"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "group/search relative flex h-(--np-field-h) w-full min-w-0 items-center gap-2 rounded-(--np-radius-pill) bg-fill-secondary pr-1.5 pl-3 text-body text-ink",
        "transition-[box-shadow,background-color] duration-(--np-duration-fast) ease-spring-snappy",
        "focus-within:[box-shadow:var(--np-focus-halo)]",
        "has-[[aria-invalid=true]]:[box-shadow:0_0_0_0.5px_var(--np-danger-line)]",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
    >
      <SearchIcon
        className="size-4 shrink-0 text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        ref={setRefs}
        type="search"
        data-slot="input"
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          if (!isControlled)
            setUncontrolledHasValue(event.target.value.length > 0)
          onChange?.(event)
        }}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted",
          "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
          "disabled:cursor-not-allowed",
          inputClassName
        )}
        {...props}
      />
      {hasValue && !disabled ? (
        <button
          type="button"
          aria-label="Clear search"
          data-slot="input-search-clear"
          onClick={clear}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-(--np-radius-pill) text-ink-muted focus-halo transition-[color,transform] duration-(--np-duration-fast) ease-spring-snappy hover:text-ink active:scale-[0.98]"
        >
          <XCircleIcon className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export { Input, SearchInput }
