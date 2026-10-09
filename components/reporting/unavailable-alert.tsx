import Link from "next/link"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { humaniseUnavailableReasons } from "@/lib/reporting/unavailable-reasons"

const RECONNECT_CODES = new Set(["permission_denied"])

/**
 * Why some (or all) figures could not be refreshed (reference
 * `unavailable-reasons`). Every reason is spelled out in plain words; the
 * raw code is never shown. A permission failure offers the way to fix it.
 */
export function UnavailableAlert({
  codes,
  title,
}: {
  codes: string[]
  title: string
}) {
  const reasons = humaniseUnavailableReasons(codes)
  if (reasons.length === 0) return null
  const reconnect = codes.some((code) => RECONNECT_CODES.has(code))
  return (
    <Alert variant="warning" data-slot="unavailable-reasons">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {reasons.length === 1 ? (
          reasons[0]
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-4.5">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
      {reconnect ? (
        <AlertActions>
          <Link
            href="/settings/connections"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            Open Google connections
          </Link>
        </AlertActions>
      ) : null}
    </Alert>
  )
}
