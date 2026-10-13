import type { Locator, Page, TestInfo } from "@playwright/test"

/**
 * What scrolls a given element, measured once, so a capture can walk it.
 *
 * The shell has two scroll models (components/app-shell/app-shell.tsx):
 *
 * - below 768px the DOCUMENT scrolls: there is no inner scroll column, the
 *   app bar is sticky and the tab bar fixed, and `html` carries
 *   `scroll-padding-top`/`-bottom` for them (app/globals.css);
 * - from 768px the shell is viewport-locked and an inner column (or a
 *   workspace pane inside it) scrolls, with its own `scroll-padding-top`
 *   for the sticky toolbar.
 *
 * `scrollOwnerFor` finds the nearest ancestor that is an `overflow-y:
 * auto|scroll` container AND actually overflows; failing that, the document
 * (`document.scrollingElement`, driven with `window.scrollTo`). Every number
 * is in the owner's scroll coordinates.
 */
export type ScrollOwner = {
  /** `document` on phones (and wherever no inner pane overflows). */
  kind: "document" | "element"
  /** Scroll offset that puts the element's top just below the owner's top inset. */
  top: number
  /** The element's bottom edge, in scroll coordinates. */
  bottom: number
  /** The owner's full client height (the viewport, for the document). */
  height: number
  /** `scroll-padding-top` of the owner: sticky chrome covering its top edge. */
  insetTop: number
  /** `scroll-padding-bottom` of the owner: fixed chrome covering its bottom edge. */
  insetBottom: number
  /** Largest scroll offset the owner accepts. */
  maximum: number
  /** Scrolls the owner instantly (ignores `scroll-behavior: smooth`) and waits a frame. */
  scrollTo: (offset: number) => Promise<void>
}

const MARKER = "data-e2e-scroll-owner"

export async function scrollOwnerFor(target: Locator): Promise<ScrollOwner> {
  const page = target.page()
  const token = `owner-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const measured = await target.evaluate(
    (element, { marker, token }) => {
      for (const previous of document.querySelectorAll(`[${marker}]`))
        previous.removeAttribute(marker)
      const scrolls = (node: HTMLElement) =>
        ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight + 1
      let parent = element.parentElement
      while (parent && parent !== document.body && !scrolls(parent))
        parent = parent.parentElement
      const owner =
        parent && parent !== document.body && scrolls(parent) ? parent : null
      const root = (document.scrollingElement ??
        document.documentElement) as HTMLElement
      const box = element.getBoundingClientRect()
      if (owner) {
        owner.setAttribute(marker, token)
        const style = getComputedStyle(owner)
        const start =
          box.top - owner.getBoundingClientRect().top + owner.scrollTop
        const insetTop = Number.parseFloat(style.scrollPaddingTop) || 0
        return {
          kind: "element" as const,
          top: Math.max(0, start - insetTop),
          bottom: start + box.height,
          height: owner.clientHeight,
          insetTop,
          insetBottom: Number.parseFloat(style.scrollPaddingBottom) || 0,
          maximum: Math.max(0, owner.scrollHeight - owner.clientHeight),
        }
      }
      // The document: scroll-padding is read from the root element, which is
      // where the phone shell declares it.
      const style = getComputedStyle(document.documentElement)
      const start = box.top + window.scrollY
      const insetTop = Number.parseFloat(style.scrollPaddingTop) || 0
      return {
        kind: "document" as const,
        top: Math.max(0, start - insetTop),
        bottom: start + box.height,
        height: root.clientHeight,
        insetTop,
        insetBottom: Number.parseFloat(style.scrollPaddingBottom) || 0,
        maximum: Math.max(0, root.scrollHeight - root.clientHeight),
      }
    },
    { marker: MARKER, token }
  )

  const scrollTo = async (offset: number) => {
    if (measured.kind === "document") {
      await page.evaluate(async (top) => {
        window.scrollTo({ top, behavior: "instant" })
        await new Promise(requestAnimationFrame)
      }, offset)
      return
    }
    await page
      .locator(`[${MARKER}="${token}"]`)
      .evaluate(async (element, top) => {
        element.scrollTo({ top, behavior: "instant" })
        await new Promise(requestAnimationFrame)
      }, offset)
  }

  return { ...measured, scrollTo }
}

/**
 * Screenshots every visible part of `target` in its scroll owner: the first
 * frame puts the element's top below the sticky chrome, each next frame
 * moves three quarters of the uncovered band, and the walk stops once the
 * element's bottom is above the bottom chrome or the owner can go no
 * further. Frames are written as `<name>-<n>.png`.
 */
export async function captureThroughScrollOwner(
  page: Page,
  info: TestInfo,
  target: Locator,
  name: string
) {
  const owner = await scrollOwnerFor(target)
  const band = Math.max(1, owner.height - owner.insetTop - owner.insetBottom)
  for (let offset = Math.min(owner.top, owner.maximum), frame = 0; ; frame++) {
    await owner.scrollTo(offset)
    await page.screenshot({
      path: info.outputPath(`${name}-${frame}.png`),
      animations: "disabled",
    })
    if (
      offset + owner.height - owner.insetBottom >= owner.bottom ||
      offset >= owner.maximum
    )
      break
    offset = Math.min(offset + band * 0.75, owner.maximum)
  }
}
