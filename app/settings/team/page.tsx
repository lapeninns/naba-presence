import { redirect } from "next/navigation"

// Team became a primary destination: for an agency, who can act on which
// client is daily work, not a settings tab visited twice a year.
export default function SettingsTeamRedirect(): never {
  redirect("/team")
}
