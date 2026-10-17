import { CircleCheck } from "lucide-react"

import { PASSWORD_LENGTH, passwordLength } from "@/lib/domain/auth-limits"
import { cn } from "@/lib/utils"

type PasswordRule = { id: string; label: string; met: boolean }

// Mirrors passwordSchema in lib/domain/auth.ts. Both must change together;
// the server remains the authority and re-validates every submission, and
// also refuses a password found in a breach, which no row here can check.
// Length is the only rule (NIST SP 800-63B-4): no letter, number or symbol
// rules, and it counts code points, exactly as the schema does.
function checkPasswordRules(value: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: "Between 15 and 128 characters",
      met:
        passwordLength(value) >= PASSWORD_LENGTH.min &&
        passwordLength(value) <= PASSWORD_LENGTH.max,
    },
  ]
}

/**
 * The rule as a small checklist that ticks itself as the password grows.
 * Each row's state is in its accessible name, so the success glyph and the
 * ink change are never the only signal.
 */
function PasswordRequirements({ value }: { value: string }) {
  return (
    <ul
      // No aria-label: "Password requirements" would match getByLabel
      // ("Password") beside the input itself. The rows name themselves.
      className="grid grid-cols-1 gap-y-1 pt-0.5"
    >
      {checkPasswordRules(value).map((rule) => (
        <li
          key={rule.id}
          aria-label={`${rule.met ? "Met" : "Not yet met"}: ${rule.label}`}
          data-met={rule.met || undefined}
          className={cn(
            "flex items-center gap-1.5 text-caption transition-colors duration-(--np-duration-fast)",
            rule.met ? "text-ink" : "text-ink-muted"
          )}
        >
          {rule.met ? (
            <CircleCheck
              className="size-3.5 shrink-0 text-success-ink"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : (
            <span
              aria-hidden
              className="size-3.5 shrink-0 rounded-full border-[1.5px] border-line-strong"
            />
          )}
          {rule.label}
        </li>
      ))}
    </ul>
  )
}

export { PasswordRequirements, checkPasswordRules }
