"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

import { stepUpFocusOrigin } from "@/components/auth/step-up-focus"
import { MFA_STEP_UP_EVENT, type MfaStepUpEventDetail } from "@/lib/api/client"

const MfaStepUpPrompt = dynamic(
  () =>
    import("@/components/auth/mfa-step-up-prompt").then(
      (m) => m.MfaStepUpPrompt
    ),
  { ssr: false }
)

/**
 * Mounts the two-step verification prompt the first time an action asks for
 * it. The prompt (dialog, password field, code validation) is rarely needed,
 * so it is not part of every page's JavaScript: this listens for
 * MFA_STEP_UP_EVENT, loads it, and opens it for that first event. From then
 * on the prompt listens for itself.
 */
export function MfaStepUpHost() {
  const [first, setFirst] = useState<{
    code: MfaStepUpEventDetail["code"]
    origin: HTMLElement | null
  } | null>(null)

  useEffect(() => {
    if (first) return
    function onStepUp(event: Event) {
      const detail = (event as CustomEvent<MfaStepUpEventDetail>).detail
      if (detail?.code)
        setFirst({ code: detail.code, origin: stepUpFocusOrigin() })
    }
    window.addEventListener(MFA_STEP_UP_EVENT, onStepUp)
    return () => window.removeEventListener(MFA_STEP_UP_EVENT, onStepUp)
  }, [first])

  return first ? (
    <MfaStepUpPrompt initialCode={first.code} initialOrigin={first.origin} />
  ) : null
}
