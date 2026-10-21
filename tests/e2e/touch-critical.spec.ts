import { expect, type Locator, type Page, test } from "@playwright/test"
import postgres from "postgres"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../integration/helpers/tenant"
import { GOOGLE_READS_TIMEOUT, profileLoadedFromGoogle } from "./helpers/settled"
import { readJourneyState } from "./helpers/stub-bridge"

// The critical journeys on a phone held in the hand: the `touch-390` project
// (playwright.config.ts) runs this file, and only that project does, at
// 390x844 with touch events, the mobile viewport meta and a 3x screen. Every
// press here is a tap (`locator.tap()`, which dispatches touch events) or a
// raw touch gesture, never a mouse click, so the paths a finger takes are the
// ones under test: Base UI's touch handling, the tab bar, the docked bars.
//
// Nothing here publishes, saves or sends. Edits stay on the page, so the
// seeded journey tenant every other spec reads is left as it was. The
// reverse holds too: no journey here depends on what earlier specs did to
// that tenant. The inbox journeys run on a tenant of their own (below), and
// an edit to a field the journey tenant shares sets its caret explicitly.

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

type InboxTenant = {
  cookie: string
  reviewId: string
  text: string
  /** For a journey that needs more reviews than the one seeded here. */
  seed: {
    organisationId: string
    connectionId: string
    googleAccountName: string
  }
}

/**
 * The inbox journeys' own tenant. The journey tenant's reviews are shared
 * with journeys.spec, which publishes a reply to one, moving it out of
 * "Needs reply" and turning its composer's action into "Update reply"; in a
 * full run that happens first, whatever the order. So each inbox journey gets
 * a fresh agency organisation set up the way the journey tenant is (direct
 * publishing confirmed, no approval step), one Google connection and one
 * never-replied review, destroyed after the test. Its cookie is applied in
 * the test body, because the describe's beforeEach (which signs in as the
 * journey tenant) runs after fixtures.
 */
const touchTest = test.extend<
  { inboxTenant: InboxTenant },
  { harnessAdmin: ReturnType<typeof postgres> }
>({
  harnessAdmin: [
    // Playwright requires the first fixture argument to be destructured.
    async ({}, provide) => {
      const url = process.env.DIRECT_DATABASE_URL
      if (!url) {
        throw new Error(
          "DIRECT_DATABASE_URL (the harness database) is required to seed the touch inbox tenant."
        )
      }
      const admin = postgres(url, { max: 1 })
      await provide(admin)
      await admin.end()
    },
    { scope: "worker" },
  ],
  inboxTenant: async ({ harnessAdmin }, provide) => {
    const tenant = await createTestTenant(harnessAdmin)
    try {
      await harnessAdmin`
        update organisation
        set
          approval_required = false,
          require_two_person_approval = false,
          direct_publish_consent_at = now(),
          direct_publish_consent_by = ${tenant.userId}
        where id = ${tenant.organisationId}
      `
      const connection = await seedGoogleConnection(harnessAdmin, {
        organisationId: tenant.organisationId,
      })
      const text = "Touch project review"
      const review = await seedLinkedReview(harnessAdmin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        text,
        rating: 5,
      })
      // Filed under a client, as every journey-tenant location is, so the
      // agency inbox shows it the way it shows real work.
      await harnessAdmin`
        with filed as (
          insert into client (organisation_id, name, slug)
          values (${tenant.organisationId}, 'Touch Hospitality', 'touch-hospitality')
          returning id
        )
        update location set client_id = (select id from filed)
        where id = ${review.locationId}
      `
      await provide({
        cookie: tenant.cookie,
        reviewId: review.reviewId,
        text,
        seed: {
          organisationId: tenant.organisationId,
          connectionId: connection.connectionId,
          googleAccountName: connection.googleAccountName,
        },
      })
    } finally {
      await destroyTenants(harnessAdmin, [tenant.organisationId])
    }
  },
})

/**
 * Put the caret at the end of a text field. A tap lands it wherever the
 * finger was, and End does not move it on every platform (not on macOS), so
 * typing after a tap would splice into the middle of whatever value an
 * earlier spec left there.
 */
async function caretToEnd(field: Locator) {
  await field.evaluate((element) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement
    input.setSelectionRange(input.value.length, input.value.length)
  })
}

/**
 * Wait for the screen to stop moving before any geometry, cover or hit
 * assertion. The phone's chrome animates: a docked bar slides up on mount
 * (`starting:translate-y-full`), a sheet rises, the tab bar steps aside, the
 * keyboard inset is written a frame after the viewport changes. Settled
 * means, at once: no finite animation or transition running in the document
 * (an endless spinner or skeleton pulse is not movement of the chrome), and
 * the rects of the chrome (docked bars, sheets, the tab bar, the focused
 * element) plus the measured elements and the visual viewport identical
 * across two requestAnimationFrame frames. It only waits; every assertion
 * after it is unchanged.
 */
async function settle(page: Page, ...measured: Locator[]) {
  await expect
    .poll(
      async () => {
        const handles = (
          await Promise.all(measured.map((locator) => locator.elementHandles()))
        ).flat()
        return page.evaluate(async (elements) => {
          const frame = () =>
            new Promise((resolve) => requestAnimationFrame(resolve))
          const watched = [
            ...document.querySelectorAll(
              "[data-docked], [data-slot=tab-bar], [data-slot=setup-footer], [data-slot=composer-footer], [role=dialog], [role=alertdialog]"
            ),
            ...(document.activeElement ? [document.activeElement] : []),
            ...(elements as Element[]),
          ]
          const snapshot = () =>
            JSON.stringify([
              ...watched.map((element) => {
                const rect = element.getBoundingClientRect()
                return [rect.x, rect.y, rect.width, rect.height]
              }),
              [
                window.visualViewport?.height,
                window.visualViewport?.offsetTop,
                window.innerHeight,
                window.innerWidth,
              ],
            ])
          const moving = () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  Number.isFinite(
                    animation.effect?.getComputedTiming().endTime ?? Infinity
                  )
              ).length
          const first = snapshot()
          await frame()
          const second = snapshot()
          await frame()
          const third = snapshot()
          return moving() === 0 && first === second && second === third
        }, handles)
      },
      { message: "the screen settles", timeout: 5_000 }
    )
    .toBe(true)
}

/** The project floor for anything a finger presses (spec: touch targets). */
const TARGET_FLOOR = 44

/**
 * Tap a control after checking its real hit band meets the 44px floor. The
 * band is found by hit-testing, not read off the control's box: from the
 * control's centre, `document.elementFromPoint` is probed outward in 1px
 * steps along each axis while the press still lands on the control (or a
 * ::before/::after overhang, which hit-tests as the control) or on the
 * <label> that owns it (a switch or checkbox row is pressed anywhere on its
 * label). The narrower of the two runs is the touch dimension.
 */
async function tap(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  await settle(control.page(), control)
  const band = await control.evaluate((element) => {
    const label =
      element.closest("label") ??
      (element.id
        ? document.querySelector<HTMLElement>(
            `label[for="${CSS.escape(element.id)}"]`
          )
        : null)
    const lands = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight)
        return false
      const hit = document.elementFromPoint(x, y)
      return Boolean(
        hit &&
        (element === hit ||
          element.contains(hit) ||
          (label && (label === hit || label.contains(hit))))
      )
    }
    const rect = element.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const reach = (dx: number, dy: number) => {
      let step = 0
      while (step < 400 && lands(cx + dx * (step + 1), cy + dy * (step + 1)))
        step++
      return step
    }
    const centre = lands(cx, cy)
    const labelledBy = element
      .getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
    const hit = document.elementFromPoint(cx, cy)
    return {
      centre,
      width: centre ? reach(-1, 0) + reach(1, 0) + 1 : 0,
      height: centre ? reach(0, -1) + reach(0, 1) + 1 : 0,
      name:
        element.getAttribute("aria-label") ||
        labelledBy ||
        label?.textContent?.trim().slice(0, 40) ||
        element.textContent?.trim().slice(0, 40) ||
        element.tagName,
      evidence: JSON.stringify({
        control: element.outerHTML.slice(0, 300),
        rect: [rect.left, rect.top, rect.width, rect.height],
        hit: hit?.outerHTML.slice(0, 300) ?? null,
        viewport: [window.innerWidth, window.innerHeight],
      }),
    }
  })
  expect(
    band.centre,
    `a tap on "${band.name}" lands on something else: ${band.evidence}`
  ).toBe(true)
  expect(
    Math.min(band.width, band.height),
    `hit band of "${band.name}" is ${band.width}x${band.height}px`
  ).toBeGreaterThanOrEqual(TARGET_FLOOR)
  await control.tap()
}

/**
 * Chromium has no on-screen keyboard, so the iOS one is simulated where the
 * app reads it: `window.visualViewport`. An iOS keyboard overlays the layout
 * viewport and shrinks only the visual viewport; the app turns that into
 * `--np-keyboard-inset` and `<html data-keyboard="open">`
 * (components/app-shell/viewport-insets.tsx), the docked bars ride on top of
 * it, and lib/editors/use-keep-focus-clear.ts scrolls the focused field
 * clear. The shim subtracts a height from `visualViewport.height`; the
 * keyboard then rises the way a real one does, a few resize events across
 * several frames, and settles.
 */
async function installKeyboardShim(page: Page) {
  await page.addInitScript(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const proto = Object.getPrototypeOf(viewport) as object
    const height = Object.getOwnPropertyDescriptor(proto, "height")!
    Object.defineProperty(proto, "height", {
      configurable: true,
      get() {
        const covered = (window as unknown as { __touchKeyboard?: number })
          .__touchKeyboard
        return (height.get!.call(this) as number) - (covered ?? 0)
      },
    })
  })
}

/** An iPhone keyboard with its suggestion bar, at 390px wide. */
const KEYBOARD_HEIGHT = 336

async function openKeyboard(page: Page) {
  await page.evaluate(async (full) => {
    const frames = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    for (const step of [0.25, 0.5, 0.75, 1]) {
      ;(window as unknown as { __touchKeyboard: number }).__touchKeyboard =
        Math.round(full * step)
      window.visualViewport!.dispatchEvent(new Event("resize"))
      await frames()
    }
  }, KEYBOARD_HEIGHT)
  await expect(page.locator("html")).toHaveAttribute("data-keyboard", "open")
  await settle(page)
}

/**
 * How many pixels of the focused element are covered: by the bar (its top
 * edge, whatever its height), by the on-screen keyboard (the visual
 * viewport's bottom edge) and by the app bar at the top. All zero means the
 * focused field is fully in view (WCAG 2.4.11, which the project holds to
 * "not even partly hidden").
 */
async function focusCoverage(page: Page, barSelector: string) {
  return page.evaluate((selector) => {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement) || focused === document.body)
      return {
        focused: "nothing",
        underBar: -1,
        underKeyboard: -1,
        underAppBar: -1,
      }
    const rect = focused.getBoundingClientRect()
    const bars = [...document.querySelectorAll<HTMLElement>(selector)]
      .map((bar) => bar.getBoundingClientRect())
      .filter((bar) => bar.height > 0)
    const barTop = bars.length
      ? Math.min(...bars.map((bar) => bar.top))
      : Number.POSITIVE_INFINITY
    const viewport = window.visualViewport!
    const visibleBottom = viewport.offsetTop + viewport.height
    const appBar = document.querySelector("header")?.getBoundingClientRect()
    const appBarBottom =
      appBar &&
      getComputedStyle(document.querySelector("header")!).position !== "static"
        ? appBar.bottom
        : 0
    return {
      focused: focused.tagName.toLowerCase(),
      underBar: Math.max(0, Math.round(rect.bottom - barTop)),
      underKeyboard: Math.max(0, Math.round(rect.bottom - visibleBottom)),
      underAppBar: Math.max(0, Math.round(appBarBottom - rect.top)),
    }
  }, barSelector)
}

async function expectFocusClear(
  page: Page,
  barSelector: string,
  focused: string,
  when: string
) {
  await settle(page)
  await expect
    .poll(() => focusCoverage(page, barSelector), {
      message: `the focused ${focused} is covered (px) ${when}`,
      timeout: 3_000,
    })
    .toEqual({ focused, underBar: 0, underKeyboard: 0, underAppBar: 0 })
}

/** The element at a control's centre is the control: nothing lies over it. */
async function expectNotCovered(control: Locator, what: string) {
  await settle(control.page(), control)
  const result = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    )
    return {
      onTop: Boolean(hit && (hit === element || element.contains(hit))),
      evidence: JSON.stringify({
        rect: [rect.left, rect.top, rect.width, rect.height],
        hit: hit
          ? {
              html: hit.outerHTML.slice(0, 200),
              slot: hit.closest("[data-slot]")?.getAttribute("data-slot"),
              rect: (() => {
                const box = hit.getBoundingClientRect()
                return [box.left, box.top, box.width, box.height]
              })(),
            }
          : null,
        viewport: [
          window.innerWidth,
          window.innerHeight,
          window.visualViewport?.height,
          window.visualViewport?.offsetTop,
        ],
      }),
    }
  })
  expect(
    result.onTop,
    `${what} is covered by something drawn over it: ${result.evidence}`
  ).toBe(true)
}

/** A finger dragging from a point by (dx, dy), as raw touch events. */
async function drag(page: Page, from: Locator, dx: number, dy: number) {
  const box = (await from.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  })
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x + (dx * step) / 10, y: y + (dy * step) / 10, id: 1 },
      ],
    })
    // One frame between moves, as a finger's samples arrive: wait for the
    // page's next frame rather than a fixed 16 ms.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
  await cdp.detach()
}

/** A finger dragging down from a point, as raw touch events. */
const swipeDown = (page: Page, from: Locator, distance = 400) =>
  drag(page, from, 0, distance)

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Primary" })

test.describe("touch: critical journeys at 390x844", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
  })

  test("the project is a touch phone", async ({ page }) => {
    await page.goto("/inbox")
    const device = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      touch: navigator.maxTouchPoints > 0,
      coarse: matchMedia("(pointer: coarse)").matches,
      ratio: window.devicePixelRatio,
    }))
    expect(device).toEqual({
      width: 390,
      height: 844,
      touch: true,
      coarse: true,
      ratio: 3,
    })
  })

  test("shell: the tab bar navigates and marks the current tab", async ({
    page,
  }) => {
    await page.goto("/inbox")
    const tabs = tabBar(page)
    await expect(tabs).toHaveAttribute("data-slot", "tab-bar")
    await expect(tabs.getByRole("link", { name: /^Inbox/ })).toHaveAttribute(
      "aria-current",
      "page"
    )
    for (const tab of [
      { name: "Listings", path: /\/listings$/, heading: "Listings" },
      { name: "Clients", path: /\/clients$/, heading: "Clients" },
      { name: "Reports", path: /\/reports$/, heading: "Reports" },
      { name: "Inbox", path: /\/inbox$/, heading: "Inbox" },
    ]) {
      const link = tabs.getByRole("link", { name: new RegExp(`^${tab.name}`) })
      await tap(link)
      await expect(page).toHaveURL(tab.path)
      await expect(
        page.getByRole("heading", { name: tab.heading, level: 1 })
      ).toBeVisible()
      await expect(link).toHaveAttribute("aria-current", "page")
      // Exactly one tab is current.
      await expect(tabs.locator("[aria-current=page]")).toHaveCount(1)
    }
  })

  test("shell: the More sheet opens by tap and closes by tap and by swipe", async ({
    page,
  }) => {
    await page.goto("/inbox")
    const more = tabBar(page).getByRole("button", { name: "More", exact: true })
    const sheet = page.getByRole("dialog", { name: "More" })

    // While the modal sheet is open the rest of the page leaves the
    // accessibility tree, so More's state is read from the DOM.
    const moreButton = page.locator(
      "[data-slot=tab-bar] button[aria-haspopup=dialog]"
    )
    await tap(more)
    await expect(sheet).toBeVisible()
    await expect(moreButton).toHaveAttribute("aria-expanded", "true")
    await tap(sheet.getByRole("button", { name: "Close" }))
    await expect(sheet).toBeHidden()
    await expect(more).toHaveAttribute("aria-expanded", "false")

    await tap(more)
    await expect(sheet).toBeVisible()
    // Let the sheet finish rising before the finger lands on it.
    await settle(page, sheet)
    await swipeDown(page, sheet.getByRole("heading", { name: "More" }))
    await expect(sheet).toBeHidden()
    await expect(more).toBeFocused()
  })

  // The row-actions demo on /design-system (app/design-system/ux-p10-demo.tsx;
  // the route is on here because playwright.config.ts sets
  // DESIGN_SYSTEM_EVIDENCE_ENABLED).
  test("rows: a left swipe reveals the trailing actions and the button reaches the same ones", async ({
    page,
  }) => {
    await page.goto("/design-system")
    const demo = page.locator("#ux-p10-row-actions")
    const log = demo.getByTestId("ux-p10-log")
    // A row's name is its title followed by its preview line.
    const hit = (name: string) =>
      demo.getByRole("button", { name: new RegExp(`^${name}\\b`) })
    const amelia = hit("Amelia Hart")
    await amelia.scrollIntoViewIfNeeded()
    await settle(page, amelia)

    // A vertical drag on a row scrolls the page: it never opens the row.
    await drag(page, amelia, 0, -120)
    await expect(
      demo.locator("[data-slot=list-row-swipe][data-open]")
    ).toHaveCount(0)

    // A left swipe reveals the action; the swipe alone does not open the
    // review. Only the open row's action is looked up: every row has its
    // own (inert, zero-width) Archive button in the page.
    await amelia.scrollIntoViewIfNeeded()
    await settle(page, amelia)
    await drag(page, amelia, -120, 0)
    const openRow = demo.locator("[data-slot=list-row-swipe][data-open]")
    await expect(openRow).toHaveCount(1)
    await expect(log).toHaveText("No action yet.")
    const archive = openRow.getByRole("button", {
      name: "Archive",
      exact: true,
    })
    await expect(archive).toBeVisible()
    await settle(page, archive)
    await tap(archive)
    await expect(log).toHaveText("Archived Amelia Hart.")
    // Running the action closes the row and puts its actions out of reach.
    await expect(openRow).toHaveCount(0)
    await expect(
      demo.locator("[data-slot=list-row-swipe-actions]:not([inert])")
    ).toHaveCount(0)

    // The visible button reaches the same actions with no swipe at all.
    await tap(demo.getByRole("button", { name: "Actions for Tom Reeve" }))
    const menuItem = page.getByRole("menuitem", { name: "Archive" })
    await expect(menuItem).toBeVisible()
    await tap(menuItem)
    await expect(log).toHaveText("Archived Tom Reeve.")
  })

  test("shell: a More destination, a pushed page and its Back", async ({
    page,
  }) => {
    await page.goto("/inbox")
    const more = tabBar(page).getByRole("button", { name: "More", exact: true })
    await tap(more)
    const sheet = page.getByRole("dialog", { name: "More" })
    await tap(
      sheet
        .getByRole("navigation", { name: "More" })
        .getByRole("link", { name: "Settings", exact: true })
    )
    await expect(page).toHaveURL(/\/settings$/)
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 })
    ).toBeVisible()
    // No tab holds Settings, so More says it contains the current page.
    await expect(more).toHaveAttribute("data-current", "true")
    await expect(tabBar(page).locator("[aria-current=page]")).toHaveCount(0)

    await tap(page.getByRole("link", { name: /^Reply policy/ }))
    await expect(page).toHaveURL(/\/settings\/policy$/)
    await expect(
      page.getByRole("heading", { name: "Reply policy", level: 1 })
    ).toBeVisible()
    const back = page
      .getByRole("banner")
      .getByRole("link", { name: "Back to Settings" })
    await tap(back)
    await expect(page).toHaveURL(/\/settings$/)
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 })
    ).toBeVisible()
  })

  touchTest(
    "inbox: a review opens as a pushed detail with exactly one way back",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto("/inbox")
      const list = page.getByRole("region", { name: "Review list" })
      await tap(
        list.getByRole("button", {
          // The excerpt ends the row's name now (who, status and time come
          // first), so it is followed by a space or by nothing.
          name: new RegExp(inboxTenant.text + "(?: |$)"),
        })
      )
      await expect(page).toHaveURL(
        new RegExp(`[?&]selected=${inboxTenant.reviewId}`)
      )
      const detail = page.getByRole("region", { name: "Selected review" })
      await expect(detail).toBeVisible()
      await expect(detail.getByText(inboxTenant.text)).toBeVisible()
      // The list is pushed away, not beside the review, on a phone.
      await expect(list).toBeHidden()
      // R08: no head band under the app bar. The reviewer's name is the
      // page's one h1, and the steps sit on its row at a touch size.
      await expect(page.locator("[data-slot=review-head]")).toHaveCount(0)
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
      await expect(detail.locator("h1[data-slot=review-heading]")).toBeVisible()
      for (const name of ["Previous review", "Next review"]) {
        const step = await detail.getByRole("button", { name }).boundingBox()
        expect(step!.width, `${name} width`).toBeGreaterThanOrEqual(44)
        expect(step!.height, `${name} height`).toBeGreaterThanOrEqual(44)
      }
      // One way back, whether it is drawn as a button or a link.
      const backControls = page
        .getByRole("button", { name: /^Back\b/ })
        .or(page.getByRole("link", { name: /^Back\b/ }))
      await expect(backControls).toHaveCount(1)
      await tap(backControls)
      await expect(list).toBeVisible()
      await expect(page).not.toHaveURL(/[?&]selected=/)
    }
  )

  // INB-08: one review is triaged from its row, not through Select mode. The
  // inbox tenant is a throwaway (destroyed after each test), so marking its
  // one review as needing no reply leaves nothing behind for other specs.
  touchTest(
    "inbox: a left swipe on a row marks the review as needing no reply, with an Undo",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto("/inbox")
      const list = page.getByRole("region", { name: "Review list" })
      const row = list.getByRole("button", {
        name: new RegExp(inboxTenant.text + "(?: |$)"),
      })
      await row.scrollIntoViewIfNeeded()
      await settle(page, row)

      // The swipe alone neither opens the review nor sends anything.
      await drag(page, row, -120, 0)
      const openRow = list.locator("[data-slot=list-row-swipe][data-open]")
      await expect(openRow).toHaveCount(1)
      expect(new URL(page.url()).searchParams.get("selected")).toBeNull()
      const action = openRow.getByRole("button", {
        name: "No reply needed",
        exact: true,
      })
      await expect(action).toBeVisible()
      await tap(action)

      // No question first (R06b): it is done, and Undo is in the toast.
      await expect(page.getByRole("alertdialog")).toHaveCount(0)
      await expect(page.getByText("Marked as no reply needed")).toBeVisible()
      await expect(page.locator("[data-slot=review-row]")).toHaveCount(0)
      await tap(page.getByRole("button", { name: "Undo" }))
      await expect(page.getByText("Review back in Needs reply")).toBeVisible()
      await expect(page.locator("[data-slot=review-row]")).toHaveCount(1)
    }
  )

  touchTest(
    "inbox: a row's visible actions button reaches the same action with no swipe",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto("/inbox")
      const list = page.getByRole("region", { name: "Review list" })
      await expect(
        list.getByRole("button", {
          name: new RegExp(inboxTenant.text + "(?: |$)"),
        })
      ).toBeVisible()

      await tap(list.getByRole("button", { name: /^Actions for / }))
      await tap(page.getByRole("menuitem", { name: "No reply needed" }))
      await expect(page.getByRole("alertdialog")).toHaveCount(0)
      await expect(page.getByText("Marked as no reply needed")).toBeVisible()
      await expect(page.locator("[data-slot=review-row]")).toHaveCount(0)
    }
  )

  // AMA-146: the open review's code loads apart from the list. A page opened
  // on a review hydrates the server's pane in place; an update before its
  // code arrived used to discard it and draw it again, flashing the skeleton
  // and replacing the ⋯ under a tap.
  touchTest(
    "inbox: a review opened from its link keeps the server's pane through hydration",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto(`/inbox?selected=${inboxTenant.reviewId}`, {
        waitUntil: "commit",
      })
      const more = page
        .getByRole("region", { name: "Selected review" })
        .getByRole("button", { name: "More actions" })
      // The server's button, before the pane's code has arrived.
      const served = await more.elementHandle()

      // Opening the menu needs the pane hydrated, so its code is in by now.
      await tap(more)
      await expect(
        page.getByRole("menuitem", { name: "No reply needed" })
      ).toBeVisible()
      expect(await served?.evaluate((node) => node.isConnected)).toBe(true)
    }
  )

  touchTest(
    "inbox: an open review's ⋯ carries No reply needed and Assign…",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto(`/inbox?selected=${inboxTenant.reviewId}`)
      const detail = page.getByRole("region", { name: "Selected review" })
      await expect(detail).toBeVisible()

      // On a phone the menu is a sheet: the people are listed in it, and
      // the triage action is one tap from the ⋯.
      await tap(detail.getByRole("button", { name: "More actions" }))
      await expect(
        page.getByRole("menuitem", { name: "No reply needed" })
      ).toBeVisible()
      await expect(
        page.getByRole("menuitem", { name: "Unassign" })
      ).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Assign…" })).toHaveCount(
        0
      )
      await tap(page.getByRole("menuitem", { name: "No reply needed" }))
      // No question first (R06b): it is done, and Undo is in the toast.
      await expect(page.getByRole("alertdialog")).toHaveCount(0)
      await expect(page.getByText("Marked as no reply needed")).toBeVisible()
    }
  )

  // R10 (INB-19): search and Filters are in the bottom third, on the tab bar,
  // and out of the way of every other bottom bar.
  touchTest(
    "inbox: search and Filters sit in the bottom third on the tab bar, and a docked bar takes the edge",
    async ({ page, baseURL, inboxTenant, harnessAdmin }) => {
      // More reviews than a screen holds, so the list's foot meets the bar.
      for (let index = 1; index <= 11; index += 1) {
        await seedLinkedReview(harnessAdmin, {
          ...inboxTenant.seed,
          text: `Touch overflow review ${index}`,
          rating: 4,
        })
      }
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto("/inbox")
      const toolbar = page.locator("[data-slot=inbox-bottom-toolbar]")
      const tabBar = page.locator("[data-slot=tab-bar]")
      await expect(toolbar).toBeVisible()
      await expect(tabBar).toBeVisible()
      await settle(page, toolbar)
      const height = page.viewportSize()!.height
      const filters = page.getByRole("button", { name: /^Filters/ })
      // The field's 44px pill is the target; the input sits inside its border.
      const pill = toolbar.locator("[data-slot=input-search]")
      for (const [name, control] of [
        ["search", pill],
        ["Filters", filters],
      ] as const) {
        const box = (await control.boundingBox())!
        expect(box.y, `${name} starts in the bottom third`).toBeGreaterThan(
          height * (2 / 3)
        )
        expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44)
      }
      // The bar rests on the tab bar: its bottom edge is the tab bar's top.
      const bar = (await toolbar.boundingBox())!
      const tabs = (await tabBar.boundingBox())!
      expect(Math.abs(bar.y + bar.height - tabs.y)).toBeLessThanOrEqual(1)
      // Sync is beside the field here, not in the page header.
      await expect(
        page
          .locator("[data-slot=inbox-title-row]")
          .getByRole("button", { name: "Sync reviews" })
      ).toBeHidden()
      await expect(
        toolbar.getByRole("button", { name: "Sync reviews" })
      ).toBeVisible()
      // The last row can be scrolled clear of the bar.
      const rows = page
        .getByRole("region", { name: "Review list" })
        .getByRole("button", { name: /Touch (?:project|overflow) review/ })
      await expect(rows).toHaveCount(12)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight > window.innerHeight
        ),
        "the list is longer than the screen"
      ).toBe(true)
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight)
      )
      const lastRow = rows.last()
      await expectNotCovered(lastRow, "the last review row")
      const lastBox = (await lastRow.boundingBox())!
      const barTop = (await toolbar.boundingBox())!.y
      expect(
        lastBox.y + lastBox.height,
        "the last row's foot is above the bar"
      ).toBeLessThanOrEqual(barTop + 1)
      await page.evaluate(() => window.scrollTo(0, 0))

      // Filters opens its sheet by tap.
      await tap(filters)
      await expect(page.getByRole("dialog", { name: /Filters/ })).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      // One bottom bar at a time: a selection brings its bar and the toolbar
      // steps aside; ending the selection brings the toolbar back.
      await tap(page.getByRole("button", { name: "Select", exact: true }))
      await tap(
        page.getByRole("checkbox", { name: /^Select the review from / }).first()
      )
      await expect(page.locator("[data-slot=bulk-action-bar]")).toBeVisible()
      await expect(toolbar).toBeHidden()
      await tap(page.getByRole("button", { name: "Cancel selection" }))
      await expect(toolbar).toBeVisible()
      await expect(tabBar).toBeVisible()

      // A toast clears the bar as it clears the tab bar: Sync's result
      // lands above the bar, not over the field.
      await tap(toolbar.getByRole("button", { name: "Sync reviews" }))
      const toast = page.locator("[data-slot=toast]").first()
      // A sync reads every listing from the Google stub (12 here).
      await expect(toast).toBeVisible({ timeout: 30_000 })
      await settle(page, toast)
      const toastBox = (await toast.boundingBox())!
      const barBox = (await toolbar.boundingBox())!
      expect(
        toastBox.y + toastBox.height,
        "the toast's foot is above the bar"
      ).toBeLessThanOrEqual(barBox.y)
    }
  )

  touchTest(
    "inbox: search takes the keyboard, the bar rides on it, and Cancel brings the tab bar back",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await installKeyboardShim(page)
      await page.goto("/inbox")
      const toolbar = page.locator("[data-slot=inbox-bottom-toolbar]")
      const search = page.getByRole("searchbox", { name: "Search reviews" })
      await tap(toolbar.locator("[data-slot=input-search]"))
      await expect(search).toBeFocused()
      await openKeyboard(page)
      await settle(page, toolbar)
      // The bar is above the keyboard's edge, with Cancel beside the field;
      // the tab bar has stepped aside, and Sync with it.
      const visibleBottom = await page.evaluate(
        () => window.visualViewport!.offsetTop + window.visualViewport!.height
      )
      // The bar rides on the keyboard: its foot is the keyboard's top edge.
      const box = (await toolbar.boundingBox())!
      expect(Math.abs(box.y + box.height - visibleBottom)).toBeLessThanOrEqual(
        1
      )
      await expect(page.locator("[data-slot=tab-bar]")).toBeHidden()
      await expect(
        toolbar.getByRole("button", { name: "Cancel" })
      ).toBeVisible()
      await expect(
        toolbar.getByRole("button", { name: "Sync reviews" })
      ).toBeHidden()
      await page.keyboard.type("lovely")
      await expect(page).toHaveURL(/[?&]search=lovely/)
      await tap(toolbar.getByRole("button", { name: "Cancel" }))
      await expect(page).not.toHaveURL(/[?&]search=/)
      // The keyboard goes with the field; the tab bar comes back and the bar
      // rests on it again, with Sync beside the field.
      await page.evaluate(() => {
        ;(window as unknown as { __touchKeyboard: number }).__touchKeyboard = 0
        window.visualViewport!.dispatchEvent(new Event("resize"))
      })
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-keyboard",
        "open"
      )
      const tabBar = page.locator("[data-slot=tab-bar]")
      await expect(tabBar).toBeVisible()
      await settle(page, toolbar)
      const rested = (await toolbar.boundingBox())!
      const tabs = (await tabBar.boundingBox())!
      expect(Math.abs(rested.y + rested.height - tabs.y)).toBeLessThanOrEqual(1)
      await expect(
        toolbar.getByRole("button", { name: "Sync reviews" })
      ).toBeVisible()
    }
  )

  touchTest(
    "inbox: on a short phone the toolbar stays in the band, and rides the keyboard while search has it",
    async ({ page, baseURL, inboxTenant }) => {
      // 320x568: a floating bar on the tab bar would put fixed chrome over a
      // quarter of the screen (audit:mobile's chrome budget).
      await page.setViewportSize({ width: 320, height: 568 })
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await installKeyboardShim(page)
      await page.goto("/inbox")
      const toolbar = page.locator("[data-slot=inbox-bottom-toolbar]")
      await expect(toolbar).toBeVisible()
      await settle(page, toolbar)
      await expect(toolbar).toHaveCSS("position", "static")
      const box = (await toolbar.boundingBox())!
      expect(box.y, "the toolbar is in the band at the top").toBeLessThan(
        568 / 2
      )
      await expect(
        page.locator("[data-slot=inbox-bottom-toolbar-spacer]")
      ).toBeHidden()
      // Sync is beside the field in the band, still not in the header.
      await expect(
        toolbar.getByRole("button", { name: "Sync reviews" })
      ).toBeVisible()
      await expect(
        page
          .locator("[data-slot=inbox-title-row]")
          .getByRole("button", { name: "Sync reviews" })
      ).toBeHidden()
      // Fixed chrome: the app bar and the tab bar, within a quarter.
      const fixed = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((element) => {
            const position = getComputedStyle(element).position
            const rect = element.getBoundingClientRect()
            return (
              (position === "fixed" || position === "sticky") &&
              rect.height > 0 &&
              rect.height < window.innerHeight * 0.9 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight
            )
          })
          .map((element) => element.getBoundingClientRect())
          .map((rect) => [Math.max(0, rect.top), Math.min(568, rect.bottom)])
      )
      const covered = new Set<number>()
      for (const [top, bottom] of fixed)
        for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1)
          covered.add(y)
      expect(covered.size / 568, "fixed chrome share").toBeLessThanOrEqual(0.25)

      // Search takes the keyboard: the bar leaves the band for the keyboard's
      // top edge, the one place a focused field stays in view.
      await tap(toolbar.locator("[data-slot=input-search]"))
      await openKeyboard(page)
      await settle(page, toolbar)
      await expect(toolbar).toHaveCSS("position", "fixed")
      // With the floating bar's own look, not the band row's.
      await expect(toolbar).toHaveCSS("border-top-width", "1px")
      await expect(toolbar).toHaveCSS("height", "64px")
      const visibleBottom = await page.evaluate(
        () => window.visualViewport!.offsetTop + window.visualViewport!.height
      )
      const riding = (await toolbar.boundingBox())!
      expect(
        Math.abs(riding.y + riding.height - visibleBottom)
      ).toBeLessThanOrEqual(1)
      await expect(
        page.getByRole("searchbox", { name: "Search reviews" })
      ).toBeFocused()
    }
  )

  touchTest(
    "inbox: on Android, where the keyboard shrinks the page, the bar stays on the tab bar through search and a tapped result",
    async ({ page, baseURL, inboxTenant }) => {
      // Android Chrome with `interactive-widget=resizes-content`: the
      // keyboard shrinks the layout viewport (under 40rem here) and sets no
      // `data-keyboard`. No shim: the viewport itself is resized.
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto("/inbox")
      const toolbar = page.locator("[data-slot=inbox-bottom-toolbar]")
      const search = page.getByRole("searchbox", { name: "Search reviews" })
      await tap(toolbar.locator("[data-slot=input-search]"))
      await expect(search).toBeFocused()
      await page.setViewportSize({ width: 390, height: 480 })
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-keyboard",
        "open"
      )
      await settle(page, toolbar)
      await expect(search).toBeFocused()
      await expect(toolbar).toHaveCSS("position", "fixed")
      const tabBar = page.locator("[data-slot=tab-bar]")
      await expect(tabBar).toBeVisible()
      const bar = (await toolbar.boundingBox())!
      const tabs = (await tabBar.boundingBox())!
      expect(Math.abs(bar.y + bar.height - tabs.y)).toBeLessThanOrEqual(1)
      // Leaving search returns a short screen's bar to the band.
      await tap(toolbar.getByRole("button", { name: "Cancel" }))
      await expect(toolbar).toHaveCSS("position", "static")

      // Search mode, not focus, holds the bar: a result tapped near its top
      // edge takes focus from the field, and the list must not move under
      // the finger before the tap lands.
      await tap(toolbar.locator("[data-slot=input-search]"))
      await expect(search).toBeFocused()
      await page.keyboard.type("Touch")
      await expect(page).toHaveURL(/[?&]search=Touch/)
      const result = page
        .getByRole("region", { name: "Review list" })
        .getByRole("button", { name: new RegExp(inboxTenant.text) })
        .first()
      await expect(result).toBeVisible()
      await settle(page, result)
      await result.tap({ position: { x: 40, y: 8 } })
      await expect(page).toHaveURL(
        new RegExp(`[?&]selected=${inboxTenant.reviewId}`)
      )
    }
  )

  touchTest(
    "inbox: an open review has no toolbar over it",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await page.goto(`/inbox?selected=${inboxTenant.reviewId}`)
      await expect(
        page.getByRole("region", { name: "Selected review" })
      ).toBeVisible()
      await expect(
        page.locator("[data-slot=inbox-bottom-toolbar]")
      ).toBeHidden()
    }
  )

  touchTest(
    "inbox: the reply composer's docked bar keeps the focused reply clear, with the keyboard up",
    async ({ page, baseURL, inboxTenant }) => {
      await applyCookie(page, baseURL, inboxTenant.cookie)
      await installKeyboardShim(page)
      await page.goto(`/inbox?selected=${inboxTenant.reviewId}`)
      const reply = page.getByRole("textbox", { name: "Your reply" })
      // R08: the text box comes first, so it starts above half the screen
      // before anything is typed (it used to start at about 70%).
      await expect(reply).toBeVisible()
      await settle(page, reply)
      const replyTop = (await reply.boundingBox())!.y
      expect(replyTop).toBeLessThan(page.viewportSize()!.height * 0.5)
      await tap(reply)
      await page.keyboard.type("Thank you for the lovely review, Stub.")
      await expect(reply).toBeFocused()

      const bar = page.locator("[data-slot=composer-footer]")
      await expect(bar).toBeVisible()
      await expect(
        bar.getByRole("button", { name: "Publish reply" })
      ).toBeVisible()
      // One bar owns the bottom edge: the tab bar has stepped aside.
      await expect(page.locator("[data-slot=tab-bar]")).toBeHidden()
      await expectNotCovered(
        bar.getByRole("button", { name: "Publish reply" }),
        "Publish reply"
      )
      await expectFocusClear(
        page,
        "[data-slot=composer-footer]",
        "textarea",
        "with the keyboard down"
      )

      await openKeyboard(page)
      // The bar rides on the keyboard: its actions are above the keyboard's
      // edge, and the focused reply is above the bar.
      await settle(page, bar)
      const publish = await bar
        .getByRole("button", { name: "Publish reply" })
        .boundingBox()
      const visibleBottom = await page.evaluate(
        () => window.visualViewport!.offsetTop + window.visualViewport!.height
      )
      expect(publish!.y + publish!.height).toBeLessThanOrEqual(visibleBottom)
      await expectFocusClear(
        page,
        "[data-slot=composer-footer]",
        "textarea",
        "with the keyboard up"
      )
    }
  )

  test("listings: open a listing, edit its profile, and review the change in the sheet", async ({
    page,
  }) => {
    const state = await readJourneyState()
    await page.goto("/inbox")
    await tap(tabBar(page).getByRole("link", { name: /^Listings/ }))
    await expect(page).toHaveURL(/\/listings$/)
    await tap(
      page.getByRole("main").getByRole("link", {
        name: state.directReview.locationName,
        exact: true,
      })
    )
    await expect(page).toHaveURL(
      new RegExp(`/listings/${state.primaryLocationId}$`)
    )
    await tap(
      page
        .getByRole("region", { name: "Areas" })
        .getByRole("link", { name: /Business profile/ })
    )
    await expect(page).toHaveURL(
      new RegExp(`/listings/${state.primaryLocationId}/profile$`)
    )
    // Google's half of the listing arrives after the NabaPresence copy.
    await profileLoadedFromGoogle(page)

    const name = page.getByRole("textbox", { name: "Business name" })
    const editorBar = page.getByRole("region", { name: "Editor actions" })
    const review = editorBar.getByRole("button", {
      name: "Review changes",
      exact: true,
    })
    // A clean editor draws no bar on a phone; the first change brings it in.
    await expect(review).toBeHidden()
    const original = await name.inputValue()
    await tap(name)
    await caretToEnd(name)
    await page.keyboard.type(" Touch")
    await expect(name).toHaveValue(`${original} Touch`)

    await expect(editorBar).toBeVisible()
    await expect(editorBar).toHaveAttribute("data-docked", "bottom")
    await expect(page.locator("[data-slot=tab-bar]")).toBeHidden()
    // One row: status, the primary and the overflow; Save here and Discard
    // edits wait in the overflow menu rather than beside them.
    await expect(
      editorBar.getByRole("button", { name: "More actions", exact: true })
    ).toBeVisible()
    await expect(
      editorBar.getByRole("button", { name: "Save here", exact: true })
    ).toBeHidden()
    await expectNotCovered(review, "Review changes")
    await expectFocusClear(
      page,
      "[data-docked=bottom]",
      "input",
      "after the bar appears"
    )

    await tap(review)
    const sheet = page.getByRole("dialog", { name: "Review changes" })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText("Business name").first()).toBeVisible()
    await expect(sheet.getByText(`${original} Touch`).first()).toBeVisible()
    // A tap on the sheet's words is not a dismissal or a swipe start: the
    // plain line saying where the edit goes (a name edit saves here first).
    const routeLine = sheet.locator("[data-slot=review-route-note]")
    await expect(routeLine).toContainText("here first")
    await routeLine.tap()
    await expect(sheet).toBeVisible()
    // The sheet's own controls take a tap.
    await tap(sheet.getByRole("button", { name: "Keep editing", exact: true }))
    await expect(sheet).toBeHidden()
    await expect(name).toHaveValue(`${original} Touch`)
    await tap(review)
    await expect(sheet).toBeVisible()
    await expect(
      sheet.getByRole("button", { name: "Publish to Google", exact: true })
    ).toBeVisible()
  })

  test("listings: the controls inside a sheet take a tap (hours copy sheet)", async ({
    page,
  }) => {
    const state = await readJourneyState()
    await page.goto(`/listings/${state.primaryLocationId}/hours`)
    await expect(
      page.getByRole("heading", { name: "Opening hours", level: 1 })
    ).toBeVisible()
    // The editor itself, from the streamed read: not the tab's pending line.
    const monday = page.getByRole("switch", { name: "Monday open" })
    await expect(monday).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })
    const tuesday = page.getByRole("switch", { name: "Tuesday open" })
    await expect(monday).not.toBeChecked()
    await expect(tuesday).not.toBeChecked()
    await tap(monday)
    await expect(monday).toBeChecked()

    await tap(page.getByRole("button", { name: "Copy Monday to…" }))
    const sheet = page.getByRole("dialog", { name: "Copy Monday’s hours" })
    await expect(sheet).toBeVisible()
    const tuesdayPick = sheet.getByRole("checkbox", { name: /^Tuesday/ })
    await tap(tuesdayPick)
    await expect(tuesdayPick).toBeChecked()
    await tap(sheet.getByRole("button", { name: "Copy to 1 day", exact: true }))
    await expect(sheet).toBeHidden()
    await expect(tuesday).toBeChecked()

    const editorBar = page.getByRole("region", { name: "Editor actions" })
    await expect(editorBar).toHaveAttribute("data-docked", "bottom")
    await tap(
      editorBar.getByRole("button", { name: "Review changes", exact: true })
    )
    await expect(
      page.getByRole("dialog", { name: "Review changes" })
    ).toBeVisible()
  })

  test("settings: the grouped index, a policy edit with its docked bar, and a rotation", async ({
    page,
  }) => {
    await page.goto("/settings")
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 })
    ).toBeVisible()
    const index = page.getByRole("navigation", { name: "Settings" })
    // The shared SettingsGroup (FOUNDATION Drop 1) names its section, not
    // its list: each named group must still hold a visible list of rows.
    for (const group of ["You", "Workspace"]) {
      const region = index.getByRole("region", { name: group })
      await expect(region).toBeVisible()
      await expect(region.getByRole("list")).toBeVisible()
    }

    await tap(index.getByRole("link", { name: /^Reply policy/ }))
    await expect(page).toHaveURL(/\/settings\/policy$/)
    await expect(
      page.getByRole("heading", { name: "Reply policy", level: 1 })
    ).toBeVisible()

    const days = page.getByRole("combobox", {
      name: "How long we keep review text",
    })
    const saveBar = page.getByRole("region", { name: "Save reply policy" })
    await expect(saveBar).toHaveCount(0)
    const before = (await days.textContent())?.trim()
    const changed = before === "7 days" ? "14 days" : "7 days"
    await tap(days)
    await tap(page.getByRole("option", { name: changed, exact: true }))
    await expect(days).toHaveText(changed)

    await expect(saveBar).toBeVisible()
    await expect(saveBar).toHaveAttribute("data-docked", "bottom")
    await expect(saveBar.getByText("1 unsaved change")).toBeVisible()
    await expect(page.locator("[data-slot=tab-bar]")).toBeHidden()
    await expectFocusClear(
      page,
      "[data-docked=bottom]",
      "button",
      "after the save bar appears"
    )

    const h1 = page.getByRole("heading", { level: 1 })
    for (const [width, height] of [
      [844, 390],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height })
      await expect(h1).toHaveCount(1)
      await expect(h1).toHaveText("Reply policy")
      await expect(days).toHaveText(changed)
      await expect(saveBar).toBeVisible()
      await expect(saveBar.getByText("1 unsaved change")).toBeVisible()
    }
  })

  test("setup: the wizard's step bar keeps the focused field clear, with the keyboard up", async ({
    page,
  }) => {
    const state = await readJourneyState()
    await installKeyboardShim(page)
    await page.goto(`/setup?client=${state.clientId}&step=agency`)
    await expect(
      page.getByRole("heading", { name: "Confirm your agency", level: 2 })
    ).toBeVisible()
    const bar = page.locator("[data-slot=setup-footer]")
    const next = bar.getByRole("button", { name: "Continue", exact: true })
    await settle(page, next)
    await expect(next).toBeInViewport({ ratio: 1 })
    await expectNotCovered(next, "Continue")

    const agency = page.getByRole("textbox", { name: "Agency name" })
    await tap(agency)
    await caretToEnd(agency)
    await page.keyboard.type(" Touch")
    await expect(agency).toHaveValue(/ Touch$/)
    await expectFocusClear(
      page,
      "[data-slot=setup-footer]",
      "input",
      "with the keyboard down"
    )
    await openKeyboard(page)
    await expectFocusClear(
      page,
      "[data-slot=setup-footer]",
      "input",
      "with the keyboard up"
    )
  })

  test("setup: a blocked step's two-row bar keeps Back and Continue uncovered", async ({
    page,
  }) => {
    const state = await readJourneyState()
    // A bare client link resumes where the data has reached; for the seeded
    // client that step waits on something, so the bar carries its reason
    // over Back and Continue.
    await page.goto(`/setup?client=${state.clientId}`)
    const bar = page.locator("[data-slot=setup-footer]")
    const reason = bar.locator("#setup-continue-reason")
    await expect(reason).toBeVisible()
    await expect(reason).not.toBeEmpty()
    const back = bar.getByRole("button", { name: "Back", exact: true })
    const next = bar.getByRole("button", { name: /^Continue/ })
    await settle(page, reason, back, next)
    const [reasonBox, nextBox] = [
      (await reason.boundingBox())!,
      (await next.boundingBox())!,
    ]
    // Two rows: the reason above the buttons.
    expect(reasonBox.y + reasonBox.height).toBeLessThanOrEqual(nextBox.y)
    for (const [control, what] of [
      [back, "Back"],
      [next, "Continue"],
    ] as const) {
      await expect(control).toBeInViewport({ ratio: 1 })
      await expectNotCovered(control, what)
    }
  })

  test("setup: on a short phone a blocked step's bar is one row and the chrome stays within a quarter", async ({
    page,
  }) => {
    const state = await readJourneyState()
    // 320x568: two rows (the reason over Back and Continue) plus the app bar
    // took 27.6% of the screen. Under 640px tall the bar keeps one row.
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto(`/setup?client=${state.clientId}`)
    const bar = page.locator("[data-slot=setup-footer]")
    const reason = bar.locator("#setup-continue-reason")
    await expect(reason).toBeVisible()
    await expect(reason).not.toBeEmpty()
    const back = bar.getByRole("button", { name: "Back", exact: true })
    const next = bar.getByRole("button", { name: /^Continue/ })
    await settle(page, reason, back, next)
    const [barBox, reasonBox, nextBox, backBox] = [
      (await bar.boundingBox())!,
      (await reason.boundingBox())!,
      (await next.boundingBox())!,
      (await back.boundingBox())!,
    ]
    // One row: the reason sits beside the buttons, not above them.
    expect(reasonBox.y + reasonBox.height).toBeGreaterThan(nextBox.y)
    expect(reasonBox.x).toBeGreaterThanOrEqual(backBox.x + backBox.width)
    expect(reasonBox.x + reasonBox.width).toBeLessThanOrEqual(nextBox.x)
    // The arrow-only Back is still a full touch target.
    expect(backBox.width).toBeGreaterThanOrEqual(44)
    expect(backBox.height).toBeGreaterThanOrEqual(44)
    const top = (await page.locator("[data-slot=app-bar]").boundingBox())!
    expect((top.height + barBox.height) / 568).toBeLessThanOrEqual(0.25)
    for (const [control, what] of [
      [back, "Back"],
      [next, "Continue"],
    ] as const) {
      await expect(control).toBeInViewport({ ratio: 1 })
      await expectNotCovered(control, what)
    }
  })

  test("reports: a read journey by tap across the report tabs", async ({
    page,
  }) => {
    await page.goto("/inbox")
    await tap(tabBar(page).getByRole("link", { name: /^Reports/ }))
    await expect(page).toHaveURL(/\/reports$/)
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "Reply performance" })
    ).toHaveAttribute("aria-selected", "true")

    const google = page.getByRole("tab", { name: "Google performance" })
    await tap(google)
    await expect(google).toHaveAttribute("aria-selected", "true")
    await expect(
      page.getByText("Call button taps", { exact: true }).first()
    ).toBeVisible()

    const keywords = page.getByRole("tab", { name: "Keywords" })
    await tap(keywords)
    await expect(page).toHaveURL(/[?&]tab=keywords/)
    await expect(keywords).toHaveAttribute("aria-selected", "true")
    await expect(page.getByText("riverside hotel bath")).toBeVisible()
    // Keywords carries Google's one month, where the term's suppressed month
    // falls outside the window and it reads as an exact 1,000. One tap on the
    // longer period brings the honest "1,000+" back.
    await tap(
      page
        .getByRole("group", { name: "Period" })
        .getByRole("button", { name: "Last 6 months" })
    )
    await expect(page.getByText("1,000+")).toBeVisible()
  })
})
