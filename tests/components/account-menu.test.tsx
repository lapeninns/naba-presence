import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AccountMenu } from "@/components/app-shell/account-menu"
import { Toaster } from "@/components/ui/toast"
import { apiFetch } from "@/lib/api/client"
import {
  __resetDraftSources,
  registerDraftSource,
  stashDraft,
} from "@/lib/api/draft-stash"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"

// Sign-out is truthful: the menu leaves only when the server confirmed it,
// purges this browser's query cache and stashed drafts when it does, keeps
// the person on the page with a Retry when it did not, and treats a partial
// "everywhere" (this browser signed out, the rest unknown) as signed out here
// without claiming every device is.

const session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns Agency",
  workspaceMode: "agency" as const,
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner" as const,
  canPublish: true,
}

type SignOutAnswer = () => Response | Promise<Response>

function stubApi(signOutAnswers: SignOutAnswer[]) {
  const calls: string[] = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith("/api/session") && init?.method === "DELETE") {
        calls.push(url)
        const answer = signOutAnswers.shift()
        if (!answer) throw new Error("unexpected sign-out call")
        return answer()
      }
      if (url === "/api/organisations") {
        return Response.json({ items: [] })
      }
      if (url === "/api/after-sign-out") {
        return Response.json(
          { error: "authentication_required", message: "Sign in again." },
          { status: 401 }
        )
      }
      throw new Error(`unexpected request ${url}`)
    }
  )
  vi.stubGlobal("fetch", fetchMock)
  return calls
}

const noContent = () => new Response(null, { status: 204 })
const serverError = () =>
  Response.json(
    { error: "internal_error", message: "The request could not be completed." },
    { status: 500 }
  )
const gatewayTimeout = () =>
  new Response("An error occurred with your deployment", { status: 504 })
const everywhereFailed = () =>
  Response.json(
    {
      error: "sign_out_everywhere_failed",
      message: "Signed out on this device only.",
    },
    { status: 503 }
  )

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  assign = vi.fn()
  vi.stubGlobal("location", { ...window.location, assign })
  sessionStorage.clear()
  __resetDraftSources()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

// A dirty editor, as the hours, menu, profile and reply editors register one.
function DirtyEditor() {
  useDirtyGuard({
    key: "reply-7",
    isDirty: true,
    snapshot: () => "unsent text",
  })
  return null
}

function renderMenu(extra?: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const clear = vi.spyOn(queryClient, "clear")
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster>
        <AccountMenu session={session} />
        {extra}
      </Toaster>
    </QueryClientProvider>
  )
  return { clear }
}

async function chooseSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
  await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))
}

async function chooseSignOutEverywhere(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
  await user.click(
    await screen.findByRole("menuitem", { name: "Sign out everywhere…" })
  )
  await user.click(
    await screen.findByRole("button", { name: "Sign out everywhere" })
  )
}

describe("account menu sign-out", () => {
  it("purges the query cache and stashed drafts, then leaves, on success", async () => {
    const user = userEvent.setup()
    const calls = stubApi([noContent])
    sessionStorage.setItem("naba:draft:reply-1", "half a reply")
    sessionStorage.setItem("naba:draft:location-hours-9", "{}")
    sessionStorage.setItem("unrelated", "kept")
    const { clear } = renderMenu()

    await chooseSignOut(user)

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`${window.location.origin}/sign-in`)
    )
    expect(calls).toEqual(["/api/session"])
    expect(clear).toHaveBeenCalled()
    expect(sessionStorage.getItem("naba:draft:reply-1")).toBeNull()
    expect(sessionStorage.getItem("naba:draft:location-hours-9")).toBeNull()
    expect(sessionStorage.getItem("unrelated")).toBe("kept")
  })

  it("abandons open editors' drafts so nothing is re-stashed or held by a Leave prompt", async () => {
    const user = userEvent.setup()
    stubApi([noContent])
    registerDraftSource("composer-3", () => "another unsent reply")
    renderMenu(<DirtyEditor />)

    await chooseSignOut(user)
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`${window.location.origin}/sign-in`)
    )

    // The dirty editor no longer asks "Leave site?": staying would strand the
    // person on a signed-out page.
    const leaving = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(false)

    // A later foreground 401 or an unmount cannot write the text back.
    await expect(apiFetch("/api/after-sign-out")).rejects.toThrow()
    stashDraft("reply-7", "unsent text")
    const stashed = Object.keys(sessionStorage).filter((key) =>
      key.startsWith("naba:draft:")
    )
    expect(stashed).toEqual([])
  })

  it("does not claim the session survived a bare gateway failure", async () => {
    const user = userEvent.setup()
    stubApi([gatewayTimeout])
    renderMenu()

    await chooseSignOut(user)

    expect(await screen.findByText("Couldn’t sign out")).toBeInTheDocument()
    expect(screen.getByText(/You may still be signed in\./)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("stays on the page with a Retry when the server refuses, and retries", async () => {
    const user = userEvent.setup()
    const calls = stubApi([serverError, noContent])
    sessionStorage.setItem("naba:draft:reply-1", "half a reply")
    const { clear } = renderMenu()

    await chooseSignOut(user)

    expect(await screen.findByText("Couldn’t sign out")).toBeInTheDocument()
    expect(screen.getByText(/You’re still signed in\./)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    // Still signed in, so the draft is still theirs.
    expect(sessionStorage.getItem("naba:draft:reply-1")).toBe("half a reply")

    await user.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`${window.location.origin}/sign-in`)
    )
    expect(calls).toEqual(["/api/session", "/api/session"])
    expect(clear).toHaveBeenCalled()
  })

  it("does not claim a sign-out when the request never got an answer", async () => {
    const user = userEvent.setup()
    stubApi([
      () => {
        throw new TypeError("Failed to fetch")
      },
    ])
    renderMenu()

    await chooseSignOut(user)

    expect(await screen.findByText("Couldn’t sign out")).toBeInTheDocument()
    expect(screen.getByText(/You may still be signed in\./)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("offers Retry for a refused sign-out everywhere without leaving", async () => {
    const user = userEvent.setup()
    const calls = stubApi([serverError, noContent])
    renderMenu()

    await chooseSignOutEverywhere(user)

    expect(
      await screen.findByText("Couldn’t sign out everywhere")
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`${window.location.origin}/sign-in`)
    )
    expect(calls).toEqual(["/api/session?scope=all", "/api/session?scope=all"])
  })

  it("treats a partial sign-out everywhere as signed out here only", async () => {
    const user = userEvent.setup()
    stubApi([everywhereFailed])
    sessionStorage.setItem("naba:draft:reply-1", "half a reply")
    const { clear } = renderMenu()

    await chooseSignOutEverywhere(user)

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        `${window.location.origin}/sign-in?status=sign_out_everywhere_failed`
      )
    )
    expect(clear).toHaveBeenCalled()
    expect(sessionStorage.getItem("naba:draft:reply-1")).toBeNull()
  })
})
