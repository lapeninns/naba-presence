"use client"

import { cn } from "@/lib/utils"
import { fieldControlProps, useFieldContext } from "@/components/ui/field"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const field = useFieldContext()
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-32 w-full resize-y rounded-(--nr-radius-control) border border-border bg-card px-3 py-2 text-body focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...fieldControlProps(field)}
      {...props}
    />
  )
}

export { Textarea }
