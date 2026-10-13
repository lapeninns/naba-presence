import type { ReactNode } from "react"
import { Checkbox } from "@/components/ui/checkbox"

/**
 * The explicit consent before a send: one checkbox naming exactly what will
 * be sent, and any extra friction the flow needs (a typed confirmation for a
 * destructive request, a re-entered PIN) in `children`. Approval never
 * sends; this is the separate, deliberate step that does.
 *
 * A calm inline block, set off from what it confirms by one hairline above
 * rather than drawn as a box.
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
      className="flex min-w-0 flex-col gap-3 border-t border-line pt-3"
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
