"use client"

import { useQuery } from "@tanstack/react-query"
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
import { useToastManager } from "@/components/ui/toast"
import { signOut } from "@/lib/api/auth"
import { apiFetch } from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import { cn } from "@/lib/utils"

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

const ROLE_EXPLANATION: Record<string, string> = {
  owner: "Full access, including compliance and billing",
  admin: "Manages clients, connections and the team",
  member: "Replies to reviews and edits assigned clients",
  viewer: "Read-only",
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

async function handleSignOut(everywhere = false) {
  try {
    await signOut({ everywhere })
  } catch {
    // Best-effort: a failed clear is recoverable server-side, but a user
    // stranded on a dashboard they believe they have left is not.
  } finally {
    window.location.assign("/sign-in")
  }
}

const subscribeNever = () => () => {}

/**
 * `theme` reflects localStorage on the client but not in the server render,
 * so the radio group reads "system" until hydration has finished.
 */
function useHydrated() {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
}

/**
 * Identity, role, theme and the way out, from the sidebar's foot.
 *
 * The role is spelled out rather than shown as a bare lowercase word: "member"
 * on its own does not tell anyone what they may do, and the first question a
 * new teammate asks is why a button is disabled.
 *
 * Switching organisations lives here and only here. Most people belong to one,
 * and the item is hidden for them; the agency's own clients are a level inside
 * the organisation, not separate organisations, so this is a rare
 * account-level action rather than product navigation.
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
  const displayName = session?.displayName ?? "Account"
  const role = session?.role
  const roleLabel = role ? ROLE_LABEL[role] : null
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
  const others =
    organisations.data?.items.filter(
      (item) => item.organisationId !== session?.organisationId
    ) ?? []

  const toast = useToastManager()
  const [confirmEverywhere, setConfirmEverywhere] = React.useState(false)
  const [signingOut, setSigningOut] = React.useState(false)
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
      window.location.assign("/inbox")
    } catch (error) {
      setSwitching(false)
      toast.add({
        title: `Couldn’t switch to ${name}`,
        description: `${describeActionError(error)} You’re still in ${session?.organisationName ?? "your current organisation"}.`,
        type: "error",
      })
    }
  }

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
                rail && "md:max-[1181px]:justify-center",
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
              rail && "md:max-[1181px]:sr-only"
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
              rail && "md:max-[1181px]:hidden"
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
                {ROLE_EXPLANATION[role] ? (
                  <p className="text-caption text-ink-muted">
                    {ROLE_EXPLANATION[role]}
                  </p>
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
          <DropdownMenuItem onClick={() => void handleSignOut()}>
            <LogOut aria-hidden />
            Sign out
          </DropdownMenuItem>
          {/* Every device and organisation. Google connections and background
            sync keep running: they never depended on anyone being signed in. */}
          <DropdownMenuItem onClick={() => setConfirmEverywhere(true)}>
            <LogOut aria-hidden />
            Sign out everywhere…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* It ends every session on every device, including ones the person
        cannot see from here, so it asks first. */}
      <AlertDialog open={confirmEverywhere} onOpenChange={setConfirmEverywhere}>
        <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
          <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
          <AlertDialogDescription>
            You’ll be signed out on every device and browser, in every
            organisation. Google connections and background sync keep running.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Cancel</Button>}
            />
            <Button
              variant="danger"
              pending={signingOut}
              pendingLabel="Signing out…"
              onClick={() => {
                setSigningOut(true)
                void handleSignOut(true)
              }}
            >
              Sign out everywhere
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { AccountMenu, ROLE_EXPLANATION, ROLE_LABEL }
