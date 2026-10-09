"use client"

import { CheckIcon } from "lucide-react"

import { CLIENT_COLOURS } from "@/lib/clients/colours"
import { cn } from "@/lib/utils"

/**
 * The client-mark colour picker: a row of swatches, pressing the chosen one
 * again clears it. Shared by New client and the client's Details, so a
 * colour picked at creation can be changed later in the same control.
 *
 * The swatches are the stored values themselves; the chrome around them
 * (edge, ring, tick) is all tokens.
 */
function ClientColourField({
  value,
  onChange,
  description = "Used on the client’s mark so it is recognisable in a long list.",
}: {
  value: string | null
  onChange: (next: string | null) => void
  description?: string
}) {
  const current = value?.toLowerCase() ?? null
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-ui leading-5 font-semibold text-ink">
        Colour <span className="font-normal text-ink-muted">(optional)</span>
      </legend>
      <p className="text-caption text-ink-muted">{description}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {CLIENT_COLOURS.map((option) => {
          const selected = current === option.value.toLowerCase()
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(selected ? null : option.value)}
              aria-pressed={selected}
              aria-label={`${option.name} (${option.value})`}
              style={{ backgroundColor: option.value }}
              className={cn(
                "flex size-8 items-center justify-center rounded-(--np-radius-control) border border-line text-primary-foreground focus-halo transition-transform duration-(--np-duration-fast) ease-spring-snappy active:scale-[0.96] pointer-coarse:size-11",
                selected && "outline-2 outline-offset-2 outline-primary"
              )}
            >
              {selected ? (
                <CheckIcon aria-hidden className="size-4" strokeWidth={2} />
              ) : null}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export { ClientColourField }
