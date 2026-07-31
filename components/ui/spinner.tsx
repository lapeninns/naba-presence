import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({
  className,
  label = "Loading",
  ...props
}: React.ComponentProps<"span"> & { label?: string }) {
  return (
    <span role="status" aria-label={label} data-slot="spinner" {...props}>
      <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />
    </span>
  )
}

export { Spinner }
