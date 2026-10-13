"use client"

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import { LogOut, Monitor, Moon, MoreHorizontal, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"
import { z } from "zod"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToastManager } from "@/components/ui/toast"
import { signedOutHereOnly, signOut } from "@/lib/api/auth"
import { ApiClientError, apiFetch } from "@/lib/api/client"
import { abandonAllDrafts, clearAllStashedDrafts } from "@/lib/api/draft-stash"
import { hardNavigate } from "@/lib/client/hard-navigate"
import { useHydrated } from "@/lib/hooks/use-hydrated"
import { describeActionError } from "@/lib/errors/action-errors"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { workspaceTerms, type WorkspaceMode } from "@/lib/workspace/terms"

import type { ShellSession } from "./app-shell"

const organisationsSchema = z.object({
  items: z.array(
    z.object({ organisationId: z.string(), name: z.string(), role: z.string() })
  ),
})

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
}

function roleExplanation(
  role: string,
  mode: WorkspaceMode
): string | undefined {
  const terms = workspaceTerms(mode)
  const explanations: Record<string, string> = {
    owner: `Full access, including the ${terms.orgLower}’s settings and team`,
    admin: `Manages ${terms.scopePlural}, connections and the team`,
    member: `Replies to reviews and edits assigned ${terms.scopePlural}`,
    viewer: "Read-only",
  }
  return explanations[role]
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
] as const

function initialsFor(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return letters || "AC"
}

/**
 * Forgets everything this browser holds for the session that just ended: the
 * query cache (the full reload drops it too, but a back-forward cache restore
 * would not) and every stashed draft, which would otherwise be offered to the
 * next person who signs in on this tab. Open editors' drafts are abandoned
 * first, so no Leave prompt can hold the person on a signed-out page and no
 * later 401 or unmount can stash their text again.
 */
function purgeClientState(queryClient: QueryClient) {
  abandonAllDrafts()
  queryClient.clear()
  clearAllStashedDrafts()
}

/**
 * Everything the account controls need: who is signed in, the theme, the
 * other organisations and the two ways out. Shared by the desk sidebar's
 * account menu and the phone More sheet's account block, so the sign-out
 * purge, the failure handling and the org switch exist once.
 */
function useAccount(session: ShellSession | null) {
  const displayName = session?.displayName ?? "Account"
  const role = session?.role
  const roleLabel = role ? ROLE_LABEL[role] : null
  const mode = useWorkspaceMode()
  const explanation = role ? roleExplanation(role, mode) : undefined
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const currentTheme = hydrated && theme ? theme : "system"

  const organisations = useQuery({
    queryKey: ["organisations"],
    queryFn: ({ signal }) =>
      apiFetch("/api/organisations", { schema: organisationsSchema, signal }),
    enabled: Boolean(session),
    staleTime: 5 * 60 * 1000,
  })
  // A support impersonation session may not switch (the route refuses it:
  // a switch would mint an ordinary session and drop the support marks).
  const others = session?.supportActor
    ? []
    : (organisations.data?.items.filter(
        (item) => item.organisationId !== session?.organisationId
      ) ?? [])

  const toast = useToastManager()
  const queryClient = useQueryClient()
  const [confirmEverywhere, setConfirmEverywhere] = React.useState(false)
  const [signingOut, setSigningOut] = React.useState(false)
  // Leaves only when the server confirmed it. A failure keeps the person
  // here, still signed in, with a way to try again: sending them to the
  // sign-in page would claim a sign-out that may not have happened.
  const handleSignOut = async (everywhere: boolean) => {
    setSigningOut(true)
    try {
      await signOut({ everywhere })
    } catch (error) {
      if (signedOutHereOnly(error)) {
        // This browser is signed out; only the other devices are unknown.
        // The sign-in page says so and how to finish the job.
        purgeClientState(queryClient)
        hardNavigate("/sign-in?status=sign_out_everywhere_failed")
        return
      }
      setSigningOut(false)
      setConfirmEverywhere(false)
      toast.add({
        title: everywhere
          ? "Couldn’t sign out everywhere"
          : "Couldn’t sign out",
        // The route's own refusal means nothing changed. A lost request, or
        // a bare gateway answer (a 502 or a function timeout, which carries
        // no route error code), may have reached it and done its work.
        description: `${describeActionError(error)} ${
          error instanceof ApiClientError &&
          error.code !== "http_error" &&
          error.code !== "network_error"
            ? "You’re still signed in."
            : "You may still be signed in."
        }`,
        type: "error",
        actionProps: {
          children: "Retry",
          onClick: () => void handleSignOut(everywhere),
        },
      })
      return
    }
    purgeClientState(queryClient)
    hardNavigate("/sign-in")
  }
  const [switching, setSwitching] = React.useState(false)
  const switchTo = async (organisationId: string, name: string) => {
    setSwitching(true)
    try {
      await apiFetch("/api/session/switch", {
        method: "POST",
        body: { organisationId },
        schema: z.unknown(),
      })
      // A full reload, not a router push: switching mints a new session and
      // every cached query in memory belongs to the previous organisation.
      hardNavigate("/inbox")
    } catch (error) {
      setSwitching(false)
      toast.add({
        title: `Couldn’t switch to ${name}`,
        description: `${describeActionError(error)} You’re still in ${session?.organisationName ?? "your current organisation"}.`,
        type: "error",
      })
    }
  }

  return {
    displayName,
    role,
    roleLabel,
    explanation,
    currentTheme,
    setTheme,
    others,
    switching,
    switchTo,
    signingOut,
    handleSignOut,
    confirmEverywhere,
    setConfirmEverywhere,
  }
}

type Account = ReturnType<typeof useAccount>

/**
 * "Sign out everywhere" ends every session on every device, including ones
 * the person cannot see from here, so it asks first.
 */
function SignOutEverywhereDialog({ account }: { account: Account }) {
  return (
    <AlertDialog
      open={account.confirmEverywhere}
      onOpenChange={account.setConfirmEverywhere}
    >
      <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
        <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
        <AlertDialogDescription>
          You’ll be signed out on every device and browser, in every
          organisation. Google connections and background sync keep running.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            variant="danger"
            pending={account.signingOut}
            pendingLabel="Signing out…"
            onClick={() => void account.handleSignOut(true)}
          >
            Sign out everywhere
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Identity, role, theme and the way out, from the desk sidebar's foot (the
 * phone has the same controls as `AccountPanel` in the More sheet).
 *
 * The role is spelled out rather than shown as a bare lowercase word: "member"
 * on its own does not tell anyone what they may do, and the first question a
 * new teammate asks is why a button is disabled.
 *
 * Switching organisations lives here (and in the phone's account block) and
 * nowhere else. Most people belong to one, and the item is hidden for them;
 * the agency's own clients are a level inside the organisation, not separate
 * organisations, so this is a rare account-level action rather than product
 * navigation.
 */
function AccountMenu({
  session,
  rail = false,
  className,
}: {
  session: ShellSession | null
  /** The responsive sidebar: shows only the avatar in the icon-rail band. */
  rail?: boolean
  className?: string
}) {
  const account = useAccount(session)
  const {
    displayName,
    role,
    roleLabel,
    explanation,
    currentTheme,
    setTheme,
    others,
    switching,
    switchTo,
    signingOut,
    handleSignOut,
    setConfirmEverywhere,
  } = account

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                "flex min-h-11 w-full items-center gap-2.5 rounded-md p-2 text-left",
                "transition-colors duration-(--np-duration-fast) hover:bg-fill aria-expanded:bg-fill",
                "focus-halo focus-visible:outline-none",
                rail && "md:max-wide:justify-center",
                className
              )}
            />
          }
        >
          <span
            aria-hidden
            className="grid size-6 shrink-0 place-items-center rounded-full bg-fill text-[10.5px] font-semibold tracking-[0.02em] text-ink-secondary"
          >
            {initialsFor(displayName)}
          </span>
          <span
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              rail && "md:max-wide:sr-only"
            )}
          >
            <span className="truncate text-ui font-semibold text-ink">
              {displayName}
            </span>
            {roleLabel || session?.organisationName ? (
              <span className="truncate text-caption text-ink-muted">
                {[roleLabel, session?.organisationName]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </span>
          <MoreHorizontal
            className={cn(
              "size-4 shrink-0 text-ink-muted",
              rail && "md:max-wide:hidden"
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-[min(18rem,calc(100vw-2rem))]"
        >
          <div className="flex flex-col gap-0.5 px-2 pt-1.5 pb-2">
            <p className="truncate text-ui font-semibold text-ink">
              {displayName}
            </p>
            {session?.email ? (
              <p className="text-caption break-all text-ink-muted">
                {session.email}
              </p>
            ) : null}
            {role ? (
              <div className="mt-1.5 flex flex-col items-start gap-1">
                <span className="inline-flex h-5 items-center rounded-sm bg-fill px-1.5 font-mono text-[0.71875rem] font-medium tracking-[0.02em] text-ink-secondary uppercase">
                  {role}
                </span>
                {explanation ? (
                  <p className="text-caption text-ink-muted">{explanation}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={currentTheme}
              onValueChange={(value) => setTheme(String(value))}
            >
              {THEMES.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  closeOnClick
                >
                  <option.icon aria-hidden />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>

          {others.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Switch organisation</DropdownMenuLabel>
                {others.map((organisation) => (
                  <DropdownMenuItem
                    key={organisation.organisationId}
                    disabled={switching}
                    onClick={() =>
                      void switchTo(
                        organisation.organisationId,
                        organisation.name
                      )
                    }
                  >
                    <span className="truncate">{organisation.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={signingOut}
            onClick={() => void handleSignOut(false)}
          >
            <LogOut aria-hidden />
            Sign out
          </DropdownMenuItem>
          {/* Every device and organisation. Google connections and background
            sync keep running: they never depended on anyone being signed in. */}
          <DropdownMenuItem
            disabled={signingOut}
            onClick={() => setConfirmEverywhere(true)}
          >
            <LogOut aria-hidden />
            Sign out everywhere…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutEverywhereDialog account={account} />
    </>
  )
}

/**
 * The phone More sheet's account block: the same identity, theme,
 * organisation switch and sign-out as the desk menu, laid out as rows a
 * thumb can hit (44px) instead of a menu that opens upward out of a sheet.
 */
function AccountPanel({
  session,
  className,
}: {
  session: ShellSession | null
  className?: string
}) {
  const account = useAccount(session)
  const themeLabelId = React.useId()
  const orgLabelId = React.useId()
  return (
    <section
      aria-label="Account"
      data-slot="account-panel"
      className={cn("flex flex-col gap-4", className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ui font-semibold text-ink-secondary"
        >
          {initialsFor(account.displayName)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-body font-semibold text-ink">
            {account.displayName}
          </p>
          {session?.email ? (
            <p className="text-caption break-all text-ink-muted">
              {session.email}
            </p>
          ) : null}
          {account.roleLabel || session?.organisationName ? (
            <p className="text-caption text-ink-muted">
              {[account.roleLabel, session?.organisationName]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {account.explanation ? (
            <p className="text-caption text-ink-muted">{account.explanation}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p id={themeLabelId} className="text-ui font-semibold text-ink">
          Theme
        </p>
        <RadioGroup
          aria-labelledby={themeLabelId}
          value={account.currentTheme}
          onValueChange={(value) => account.setTheme(String(value))}
          className="grid grid-cols-3 gap-2"
        >
          {THEMES.map((option) => (
            <RadioGroupItem
              key={option.value}
              value={option.value}
              labelClassName="min-h-11 items-center rounded-(--np-radius-control) border border-line px-3 text-ui has-[[data-checked]]:border-primary has-[[data-checked]]:bg-accent-tint [&>[data-slot=radio]]:mt-0"
            >
              {option.label}
            </RadioGroupItem>
          ))}
        </RadioGroup>
      </div>

      {account.others.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p id={orgLabelId} className="text-ui font-semibold text-ink">
            Switch organisation
          </p>
          <ul aria-labelledby={orgLabelId} className="flex flex-col">
            {account.others.map((organisation) => (
              <li key={organisation.organisationId}>
                <button
                  type="button"
                  disabled={account.switching}
                  onClick={() =>
                    void account.switchTo(
                      organisation.organisationId,
                      organisation.name
                    )
                  }
                  className={PANEL_ROW_CLASS}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {organisation.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col border-t border-line pt-2">
        <button
          type="button"
          disabled={account.signingOut}
          onClick={() => void account.handleSignOut(false)}
          className={PANEL_ROW_CLASS}
        >
          <LogOut className="size-4 text-ink-muted" aria-hidden />
          Sign out
        </button>
        {/* Every device and organisation. Google connections and background
            sync keep running: they never depended on anyone being signed in. */}
        <button
          type="button"
          disabled={account.signingOut}
          onClick={() => account.setConfirmEverywhere(true)}
          className={PANEL_ROW_CLASS}
        >
          <LogOut className="size-4 text-ink-muted" aria-hidden />
          Sign out everywhere…
        </button>
      </div>
      <SignOutEverywhereDialog account={account} />
    </section>
  )
}

const PANEL_ROW_CLASS = cn(
  "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-ui font-medium text-ink",
  "transition-colors duration-(--np-duration-fast) hover:bg-fill",
  "focus-halo focus-visible:outline-none disabled:opacity-50"
)

export { AccountMenu, AccountPanel, roleExplanation, ROLE_LABEL }
