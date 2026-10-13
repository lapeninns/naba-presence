import { PageHeader } from "@/components/app-shell/page-frame"
import { SettingsIndex } from "@/components/settings/settings-index"
import { getSession } from "@/lib/server/session"

import { ReplyPolicyContent } from "./reply-policy-content"

export const metadata = { title: "Settings · NabaPresence" }

/**
 * The settings home. Below md it is an index of the areas this person may
 * open, grouped You / Workspace (settings-setup-auth-03), so a member or
 * viewer never lands inside a form they can't change. From md it is Reply
 * policy under the persistent settings tab row, which already shows every
 * area, so a desk keeps its one-click landing (and /settings deep links keep
 * working at every width). The choice is made in CSS, so exactly one h1 is
 * shown at any width and nothing flashes on hydration. The hidden half costs
 * its queries, not behaviour: a hidden policy form can't be edited, so it
 * never shows its save bar or arms its leave guard.
 */
export default async function SettingsHomePage() {
  const session = await getSession()
  return (
    <>
      <div
        data-slot="settings-index"
        className="flex flex-col gap-(--np-gap-section) md:hidden"
      >
        <PageHeader
          title="Settings"
          description="Your own preferences, and how the workspace runs."
        />
        <SettingsIndex role={session?.role ?? null} />
      </div>
      <div className="flex flex-col gap-(--np-gap-section) max-md:hidden">
        <ReplyPolicyContent session={session} />
      </div>
    </>
  )
}
