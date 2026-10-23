import { expect, type Page, type Request } from "@playwright/test"

/**
 * How long a page that reads from Google can keep loading. The server paces
 * each connection's Google calls about 500 ms apart (lib/server/google.ts's
 * rate limiter) and a console such as Administration fans out seven, so the
 * answer can outlast the 5 s default of an `expect`. The assertion that proves
 * the answer arrived takes this timeout, instead of the test waiting for the
 * whole network to go quiet first.
 */
export const GOOGLE_READS_TIMEOUT = 20_000

/**
 * Finite animations and transitions still running. Infinite ones (the
 * skeleton's shimmer, a spinner) are decoration and never end, so they are not
 * "settling".
 */
const runningFiniteAnimations = (page: Page) =>
  page.evaluate(
    () =>
      document.getAnimations().filter((animation) => {
        const end = animation.effect?.getComputedTiming().endTime ?? 0
        return animation.playState === "running" && Number.isFinite(end)
      }).length
  )

/**
 * No colour, opacity or transform transition is running. Axe samples computed
 * colours, so a popup caught mid-fade reads at partial opacity and reports a
 * contrast failure no one can see: audit the settled state, never with a rule
 * switched off. Replaces fixed sleeps that waited out an animation's length.
 */
export async function transitionsSettled(page: Page) {
  await expect.poll(() => runningFiniteAnimations(page)).toBe(0)
}

/**
 * The page has finished loading what it shows and stopped moving: no region
 * declares itself busy (the busy-region contract in components/ui/skeleton.tsx:
 * the container swapping between skeletons and content sets `aria-busy`), no
 * skeleton is left, and no transition is running. The DOM is what axe and a
 * text scan read, so this is the state they need - which a quiet network is
 * only a proxy for.
 */
export async function pageSettled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
    timeout: GOOGLE_READS_TIMEOUT,
  })
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, {
    timeout: GOOGLE_READS_TIMEOUT,
  })
  await transitionsSettled(page)
}

/** Two frames: React's effects (and the requests they start) run before the second paint. */
const framesPassed = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

/**
 * Counts the page's requests that have started and not yet finished, from the
 * call onward: install it before the navigation it should cover. `idle()` is
 * the point to assert that something did NOT happen (a request that must never
 * fire, a console error from a late response): every request issued so far has
 * been answered, so nothing it would have caused is still on its way.
 */
export function trackRequests(page: Page) {
  const pending = new Set<Request>()
  page.on("request", (request) => pending.add(request))
  page.on("requestfinished", (request) => pending.delete(request))
  page.on("requestfailed", (request) => pending.delete(request))
  return {
    async idle() {
      // Twice, with a frame between: an answer's render can start the next
      // request, and only an empty set after a frame says the chain has ended.
      for (let pass = 0; pass < 2; pass += 1) {
        await framesPassed(page)
        await expect
          .poll(() => pending.size, {
            message: "requests still in flight",
            timeout: GOOGLE_READS_TIMEOUT,
          })
          .toBe(0)
      }
    },
  }
}

/**
 * The business profile editor opens on NabaPresence's copy and Google's half
 * (the fields Google owns, such as the store code) arrives after it, over
 * several paced reads. A test that edits the profile, or measures it, needs
 * that half in: the store code field is the first thing that says so.
 */
export async function profileLoadedFromGoogle(page: Page) {
  await expect(page.getByRole("textbox", { name: "Store code" })).toBeVisible({
    timeout: GOOGLE_READS_TIMEOUT,
  })
}
