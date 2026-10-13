import type { ReactNode } from "react"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"

/**
 * The bar holding the one action that reaches Google, with a status line
 * saying why it is (or is not) ready. Other actions (read the saved outcome,
 * go back) sit outside it, so the charcoal bar always means "this sends".
 */
export function SendBar({
  label,
  status,
  children,
}: {
  /** Names the region ("Approved access request actions"). */
  readonly label: string
  readonly status: ReactNode
  /** The primary action. */
  readonly children: ReactNode
}) {
  return (
    <ActionBar
      sticky={false}
      safeArea={false}
      label={label}
      status={<ActionBarMuted>{status}</ActionBarMuted>}
      actions={children}
    />
  )
}
