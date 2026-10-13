"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

import {
  MFA_STEP_UP_EVENT,
  type MfaStepUpEventDetail,
} from "@/lib/api/client"

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
  const [firstCode, setFirstCode] = useState<
    MfaStepUpEventDetail["code"] | null
  >(null)

  useEffect(() => {
    if (firstCode) return
    function onStepUp(event: Event) {
      const detail = (event as CustomEvent<MfaStepUpEventDetail>).detail
      if (detail?.code) setFirstCode(detail.code)
    }
    window.addEventListener(MFA_STEP_UP_EVENT, onStepUp)
    return () => window.removeEventListener(MFA_STEP_UP_EVENT, onStepUp)
  }, [firstCode])

  return firstCode ? <MfaStepUpPrompt initialCode={firstCode} /> : null
}
