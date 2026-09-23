"use client"

import { X } from "lucide-react"
import * as React from "react"

import { fieldControlProps, useFieldContext } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * Chips plus a text input, for a short list of free-text values (labels,
 * keywords, service areas).
 *
 * Props
 *   value / onChange   the tags (controlled).
 *   placeholder        shown when empty.
 *   max                refuse more than this many, saying so.
 *   validate(tag)      return an error sentence to refuse a tag, or null.
 *   normalize(tag)     tidy a tag before it is added (default: trim).
 *   removeLabel(tag)   names each remove button ("Remove label Brunch").
 *   disabled, id, aria-label, aria-labelledby, aria-describedby.
 *
 * Keyboard: Enter or comma adds the typed tag; Backspace in an empty input
 * removes the last tag; each chip's remove button is its own tab stop. A
 * pasted comma- or newline-separated list adds every value. Duplicates
 * (case-insensitive) are refused with a message. Every change is announced
 * in a polite live region. Inside a `Field` it takes the Field's id, label
 * and error wiring like an Input.
 */
function TagInput({
  value,
  onChange,
  placeholder,
  max,
  validate,
  normalize = (tag) => tag.trim(),
  removeLabel = (tag) => `Remove ${tag}`,
  disabled = false,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  max?: number
  validate?: (tag: string) => string | null
  normalize?: (tag: string) => string
  removeLabel?: (tag: string) => string
  disabled?: boolean
  className?: string
  id?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
}) {
  const field = useFieldContext()
  const wiring = fieldControlProps(field)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [draft, setDraft] = React.useState("")
  const [message, setMessage] = React.useState("")
  const [announcement, setAnnouncement] = React.useState("")
  const messageId = React.useId()

  const add = (raw: string[]) => {
    const next = [...value]
    const added: string[] = []
    let problem = ""
    for (const candidate of raw) {
      const tag = normalize(candidate)
      if (!tag) continue
      if (next.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        problem = `“${tag}” is already added.`
        continue
      }
      if (max !== undefined && next.length >= max) {
        problem = `You can add up to ${max}.`
        break
      }
      const invalid = validate?.(tag)
      if (invalid) {
        problem = invalid
        continue
      }
      next.push(tag)
      added.push(tag)
    }
    setMessage(problem)
    if (added.length) {
      onChange(next)
      setAnnouncement(`Added ${added.join(", ")}.`)
    }
    return added.length > 0 || !problem
  }

  const remove = (index: number) => {
    const tag = value[index]
    onChange(value.filter((_, i) => i !== index))
    setMessage("")
    setAnnouncement(`Removed ${tag}.`)
    inputRef.current?.focus()
  }

  const commitDraft = () => {
    if (!draft.trim()) return
    if (add([draft])) setDraft("")
  }

  const inputId = id ?? wiring.id
  const describedBy =
    [ariaDescribedBy, wiring["aria-describedby"], message ? messageId : null]
      .filter(Boolean)
      .join(" ") || undefined

  return (
    <div
      data-slot="tag-input"
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
    >
      <div
        onClick={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus()
        }}
        data-disabled={disabled || undefined}
        className={cn(
          "flex min-h-(--np-field-h) w-full min-w-0 flex-wrap items-center gap-1.5 rounded-(--np-radius-field) border border-line-strong bg-(--np-field-bg) px-1.5 py-1 text-body",
          "transition-[border-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy hover:border-ink-muted",
          "focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--np-accent-tint)]",
          (wiring["aria-invalid"] || message) &&
            "border-danger-ink shadow-[0_0_0_3px_var(--np-danger-tint)]",
          disabled && "cursor-not-allowed bg-surface-alt text-ink-muted"
        )}
      >
        <ul className="contents list-none" aria-label="Added">
          {value.map((tag, index) => (
            <li
              key={tag}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-(--np-radius-pill) border border-line bg-surface-alt pr-0.5 pl-2.5 text-ui text-ink"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(index)}
                aria-label={removeLabel(tag)}
                className="relative inline-grid size-6 shrink-0 place-items-center rounded-full text-ink-muted focus-halo after:absolute after:-inset-1 after:content-[''] hover:bg-fill hover:text-ink disabled:pointer-events-none"
              >
                <X className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={describedBy}
          aria-invalid={wiring["aria-invalid"] || (message ? true : undefined)}
          enterKeyHint="enter"
          onChange={(event) => {
            const next = event.target.value
            if (next.includes(",")) {
              const parts = next.split(",")
              const last = parts.pop() ?? ""
              add(parts)
              setDraft(last)
            } else {
              setDraft(next)
              if (message) setMessage("")
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text")
            if (/[,\n]/.test(text)) {
              event.preventDefault()
              add(text.split(/[,\n]/))
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commitDraft()
            } else if (
              event.key === "Backspace" &&
              draft === "" &&
              value.length > 0
            ) {
              event.preventDefault()
              remove(value.length - 1)
            }
          }}
          onBlur={commitDraft}
          className="h-7 min-w-[8ch] flex-1 bg-transparent px-1.5 text-body text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed pointer-coarse:text-base"
        />
      </div>
      {message ? (
        <p id={messageId} className="text-caption font-medium text-danger-ink">
          {message}
        </p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}

export { TagInput }
