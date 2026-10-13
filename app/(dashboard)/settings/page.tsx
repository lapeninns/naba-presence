import { PageHeader } from "@/components/app-shell/page-frame"
import { SettingsHome } from "@/components/settings/settings-home"
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
 * working at every width). The first paint chooses in CSS, so nothing
 * flashes on hydration; once the client knows its width SettingsHome drops
 * the hidden face, so the document has exactly one h1 at any width. A
 * hidden policy form can't be edited, so before then it never shows its
 * save bar or arms its leave guard.
 */
export default async function SettingsHomePage() {
  const session = await getSession()
  return (
    <SettingsHome
      index={
        <>
          <PageHeader
            title="Settings"
            description="Your own preferences, and how the workspace runs."
          />
          <SettingsIndex
            role={session?.role ?? null}
            profile={
              session
                ? {
                    displayName: session.displayName ?? null,
                    email: session.email ?? null,
                    organisationName: session.organisationName ?? null,
                  }
                : undefined
            }
          />
        </>
      }
      policy={<ReplyPolicyContent session={session} />}
    />
  )
}
