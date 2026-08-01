import { Check, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

type PasswordRule = { id: string; label: string; met: boolean }

// Mirrors passwordSchema in lib/domain/auth.ts. Both must change together;
// the server remains the authority and re-validates every submission.
function checkPasswordRules(value: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: "Between 12 and 128 characters",
      met: value.length >= 12 && value.length <= 128,
    },
    { id: "letter", label: "A letter", met: /[A-Za-z]/.test(value) },
    { id: "number", label: "A number", met: /[0-9]/.test(value) },
    { id: "symbol", label: "A symbol", met: /[^A-Za-z0-9]/.test(value) },
  ]
}

function PasswordRequirements({ value }: { value: string }) {
  return (
    <ul className="flex flex-col gap-1">
      {checkPasswordRules(value).map((rule) => (
        <li
          key={rule.id}
          aria-label={`${rule.met ? "Met" : "Not yet met"}: ${rule.label}`}
          className={cn(
            "flex items-center gap-1.5 text-caption",
            rule.met ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {rule.met ? (
            <Check className="size-3.5 text-success" aria-hidden />
          ) : (
            <Circle className="size-3.5" aria-hidden />
          )}
          {rule.label}
        </li>
      ))}
    </ul>
  )
}

export { PasswordRequirements, checkPasswordRules }
