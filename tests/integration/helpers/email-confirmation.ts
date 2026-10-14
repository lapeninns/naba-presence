import { expect } from "vitest"

/**
 * Follows an emailed `/auth/confirm` link the way a browser does (W6-05):
 * the GET only redirects to the `/confirm-email` interstitial and sets no
 * cookie; pressing its button POSTs the form back, same-origin, which spends
 * the token and signs in. Returns the POST's response (a 303).
 */
export async function openConfirmationLink(
  link: string,
  headers: Record<string, string> = {}
) {
  const opened = await fetch(link, { headers, redirect: "manual" })
  expect(opened.status).toBe(307)
  expect(opened.headers.getSetCookie()).toEqual([])
  const interstitial = new URL(opened.headers.get("location")!)
  expect(interstitial.pathname).toBe("/confirm-email")

  const form = new URLSearchParams({
    token_hash: interstitial.searchParams.get("token_hash")!,
    type: "email",
  })
  const inviteToken = interstitial.searchParams.get("inviteToken")
  if (inviteToken) form.set("inviteToken", inviteToken)
  return fetch(new URL("/auth/confirm", link), {
    method: "POST",
    headers: { ...headers, origin: new URL(link).origin },
    body: form,
    redirect: "manual",
  })
}
