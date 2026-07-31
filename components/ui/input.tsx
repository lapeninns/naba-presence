"use client"

import { cn } from "@/lib/utils"
import { fieldControlProps, useFieldContext } from "@/components/ui/field"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const field = useFieldContext()
  return (
    <input
      type={type ?? "text"}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-(--nr-radius-field) border border-border/80 bg-card px-3 py-1 text-body shadow-xs transition-[color,box-shadow] outline-none",
        "placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:ring-3 focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...fieldControlProps(field)}
      {...props}
    />
  )
}

export { Input }
