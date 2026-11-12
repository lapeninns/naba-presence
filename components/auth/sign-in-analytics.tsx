"use client"

import { useEffect, useSyncExternalStore } from "react"

import {
  isAnalyticsEntry,
  isSafeAnalyticsReferrer,
  SIGN_IN_ANALYTICS_ORIGIN,
  SIGN_IN_ANALYTICS_PATH,
  signInReferrer,
} from "@/lib/analytics/sign-in"

const PREFERENCE_KEY = "naba-sign-in-analytics"
type Choice = "allowed" | "declined"
let sessionChoice: Choice | undefined

function subscribe(listener: () => void) {
  const events = [PREFERENCE_KEY, "storage", "popstate", "hashchange"]
  const onChange = (event: Event) => {
    if (
      event instanceof StorageEvent &&
      (event.key === PREFERENCE_KEY || event.key === null)
    ) {
      sessionChoice = undefined
    }
    listener()
  }
  for (const event of events) window.addEventListener(event, onChange)
  return () => {
    for (const event of events) window.removeEventListener(event, onChange)
  }
}

function getSavedChoice() {
  if (window.location.origin !== SIGN_IN_ANALYTICS_ORIGIN) return "unavailable"
  if (sessionChoice) return sessionChoice
  try {
    const choice = localStorage.getItem(PREFERENCE_KEY)
    if (choice === "allowed" || choice === "declined") return choice
  } catch {
    // In private browsing the choice can still apply to this page.
  }
  return undefined
}

function getChoice() {
  if (
    !isAnalyticsEntry(window.location) ||
    !isSafeAnalyticsReferrer(document.referrer)
  )
    return "unavailable"
  // The document's CSP is set on its initial request. A client-side visit
  // from another route cannot make that document eligible for the tag.
  const entry = performance.getEntriesByType("navigation")[0]
  if (!entry || !isAnalyticsEntry(new URL(entry.name))) return "unavailable"
  return getSavedChoice()
}

const getServerChoice = () => "unavailable"

type AnalyticsWindow = Window & {
  dataLayer?: unknown[]
}

function disable(id: string) {
  Reflect.set(window, `ga-disable-${id}`, true)
}

function allow(id: string) {
  if (
    !isAnalyticsEntry(window.location) ||
    !isSafeAnalyticsReferrer(document.referrer)
  )
    return
  const analytics = window as AnalyticsWindow
  Reflect.set(window, `ga-disable-${id}`, false)
  if (document.getElementById("naba-ga4")) return

  const layer = (analytics.dataLayer ??= [])
  // Google distinguishes the tag's Arguments objects from dataLayer arrays.
  const tag: (...args: unknown[]) => void = function () {
    // eslint-disable-next-line prefer-rest-params -- Google tag command format
    layer.push(arguments)
  }
  Reflect.set(window, "gtag", tag)
  tag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  })
  const referrer = signInReferrer(document.referrer)
  tag("set", {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_domain: "none",
    cookie_path: SIGN_IN_ANALYTICS_PATH,
    cookie_flags: "SameSite=Lax;Secure",
    cookie_expires: 60 * 60 * 24 * 90,
    cookie_update: false,
    // Override both URL fields for the entire tag, including automatic
    // session events. Enhanced Measurement is off for this web stream.
    page_location: SIGN_IN_ANALYTICS_ORIGIN + SIGN_IN_ANALYTICS_PATH,
    page_referrer: referrer ?? SIGN_IN_ANALYTICS_ORIGIN + "/",
    ignore_referrer: !referrer,
    page_title: "Sign in · NabaPresence",
  })
  tag("js", new Date())
  tag("config", id)
  const script = document.createElement("script")
  script.id = "naba-ga4"
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`
  script.async = true
  document.head.append(script)
}

function remember(choice: Choice, id: string) {
  if (choice === "declined") {
    disable(id)
    // The remote Google tag can use the domain and root-path defaults even
    // when we request host-only cookies scoped to sign-in. Expire the two
    // GA4 cookies in both scopes without touching application cookies.
    for (const cookie of ["_ga", `_ga_${id.slice(2)}`]) {
      for (const path of ["/", SIGN_IN_ANALYTICS_PATH]) {
        const expired = `${cookie}=; Path=${path}; Max-Age=0; Secure; SameSite=Lax`
        document.cookie = expired
        document.cookie = `${expired}; Domain=nabapresence.com`
      }
    }
  }
  try {
    // Deleting an old Allow first also works when the storage quota is
    // full and the new preference cannot be saved.
    if (choice === "declined") localStorage.removeItem(PREFERENCE_KEY)
    localStorage.setItem(PREFERENCE_KEY, choice)
    sessionChoice = undefined
  } catch {
    // Fall back to the in-memory choice when storage is unavailable.
    sessionChoice = choice
  }
  window.dispatchEvent(new Event(PREFERENCE_KEY))
}

export function SignInAnalytics({ measurementId }: { measurementId: string }) {
  const choice = useSyncExternalStore(subscribe, getChoice, getServerChoice)
  useEffect(() => {
    if (choice !== "allowed") return
    allow(measurementId)
    return () => disable(measurementId)
  }, [choice, measurementId])

  if (choice === "unavailable") return null

  return (
    <div
      role="group"
      aria-label="Analytics cookies"
      className="flex flex-col items-center gap-1 text-caption"
    >
      <p aria-live="polite">
        {choice === "allowed"
          ? "Analytics cookies are allowed on this page."
          : choice === "declined"
            ? "Analytics cookies are off."
            : "Optional cookies help us understand visits to this page."}
      </p>
      <div className="flex flex-wrap justify-center gap-x-4">
        <button
          type="button"
          aria-pressed={choice === "allowed"}
          className="inline-flex min-h-(--np-touch) items-center rounded-sm underline underline-offset-4 focus-halo focus-visible:outline-none"
          onClick={() => remember("allowed", measurementId)}
        >
          Allow analytics
        </button>
        <button
          type="button"
          aria-pressed={choice === "declined"}
          className="inline-flex min-h-(--np-touch) items-center rounded-sm underline underline-offset-4 focus-halo focus-visible:outline-none"
          onClick={() => remember("declined", measurementId)}
        >
          Decline analytics
        </button>
      </div>
    </div>
  )
}

// The privacy policy is public even when signed in, so withdrawal does not
// require a visitor to sign out. This control never loads the Google tag.
export function SignInAnalyticsOptOut({
  measurementId,
}: {
  measurementId: string
}) {
  const choice = useSyncExternalStore(
    subscribe,
    getSavedChoice,
    getServerChoice
  )
  if (choice === "unavailable") return null
  return (
    <button
      type="button"
      aria-pressed={choice === "declined"}
      className="inline-flex min-h-(--np-touch) items-center rounded-sm underline underline-offset-4 focus-halo focus-visible:outline-none"
      onClick={() => remember("declined", measurementId)}
    >
      {choice === "declined"
        ? "Analytics cookies are off"
        : "Turn off analytics"}
    </button>
  )
}
