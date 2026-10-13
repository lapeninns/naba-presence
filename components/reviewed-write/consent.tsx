import type { ReactNode } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { cardClassName } from "@/components/ui/card"

/**
 * The explicit consent before a send: one checkbox naming exactly what will
 * be sent, and any extra friction the flow needs (a typed confirmation for a
 * destructive request, a re-entered PIN) in `children`. Approval never
 * sends; this is the separate, deliberate step that does.
 */
export function ConsentSlot({
  label,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
  readonly children?: ReactNode
}) {
  return (
    <div
      data-slot="consent"
      className={cardClassName({
        surface: "sunken",
        className: "flex min-w-0 flex-col gap-3 p-3",
      })}
    >
      {children}
      <Checkbox
        label={label}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
      />
    </div>
  )
}
