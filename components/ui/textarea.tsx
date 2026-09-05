"use client"

import {
  fieldChromeClassName,
  fieldControlProps,
  useFieldContext,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const field = useFieldContext()
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldChromeClassName,
        // Same chrome as Input; the minimum height is a few lines rather than
        // the field height, and it stays user-resizable vertically.
        "min-h-24 w-full resize-y px-3 py-2",
        className
      )}
      {...fieldControlProps(field)}
      {...props}
    />
  )
}

export { Textarea }
