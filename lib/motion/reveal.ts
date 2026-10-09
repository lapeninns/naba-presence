/**
 * Scroll reveals that run once and never hide what is already visible.
 *
 * Mark a leaf group `data-reveal="rise|slide|media"`. CSS keeps every element
 * visible by default; this installs a paused Web Animation on each group
 * still below the fold, observes it with a positive bottom margin so it starts
 * just before it enters, unobserves on first intersection and keeps the final
 * frame. Elements already in view at install (first paint, restored scroll)
 * are finished immediately, so rapid scrolling never queues invisible rows.
 *
 * Returns a cleanup that cancels only the animations it owns, disconnects
 * the observer and restores visibility. Reduced motion, at install or when
 * toggled during playback, does the same.
 */
export function installReferenceReveals(
  root: ParentNode & {
    querySelectorAll: Document["querySelectorAll"]
  } = document
): () => void {
  // jsdom and some test doubles have no matchMedia, or hand back a bare
  // `{ matches }`; treat either as "no preference" and skip the listener.
  const reduced: { matches: boolean } & Partial<
    Pick<MediaQueryList, "addEventListener" | "removeEventListener">
  > =
    typeof window.matchMedia === "function"
      ? (window.matchMedia("(prefers-reduced-motion: reduce)") ?? {
          matches: false,
        })
      : { matches: false }
  const animations = new Map<HTMLElement, Animation>()
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-reveal]")
  )

  const finish = (element: HTMLElement) => {
    element.dataset.revealPlayed = "true"
    animations.get(element)?.cancel()
    animations.delete(element)
  }

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              const element = entry.target as HTMLElement
              observer?.unobserve(element)
              pending.delete(element)
              element.dataset.revealPlayed = "true"
              if (
                reduced.matches ||
                document.visibilityState === "hidden" ||
                entry.boundingClientRect.bottom <= 0
              ) {
                finish(element)
              } else {
                animations.get(element)?.play()
              }
            }
          },
          { threshold: 0, rootMargin: "0px 0px 120px 0px" }
        )
      : undefined

  // A programmatic or very fast scroll can jump an element from below the
  // fold to above it between two observer frames, so its intersection never
  // changes and the callback never fires. A passive scroll listener on the
  // window and on the nearest scrolling ancestor catches what the observer
  // missed: anything whose top has passed the fold plays (or finishes when
  // it is already out of view again), so no backlog of hidden content can
  // build up behind a fast thumb.
  const pending = new Set<HTMLElement>()
  const scrollParents = new Set<EventTarget>([window])
  const sweep = () => {
    for (const element of pending) {
      const rect = element.getBoundingClientRect()
      if (rect.top >= window.innerHeight) continue
      pending.delete(element)
      observer?.unobserve(element)
      element.dataset.revealPlayed = "true"
      if (reduced.matches || rect.bottom <= 0) finish(element)
      else animations.get(element)?.play()
    }
    if (pending.size === 0) detachScroll()
  }
  const detachScroll = () => {
    for (const target of scrollParents) {
      target.removeEventListener("scroll", sweep)
    }
  }
  const stop = () => {
    observer?.disconnect()
    detachScroll()
    pending.clear()
    elements.forEach(finish)
  }
  const onPreference = () => {
    if (reduced.matches) stop()
  }
  reduced.addEventListener?.("change", onPreference)

  let index = 0
  for (const element of elements) {
    if (element.dataset.revealPlayed === "true") continue
    const rect = element.getBoundingClientRect()
    if (
      reduced.matches ||
      !observer ||
      typeof element.animate !== "function" ||
      rect.top < window.innerHeight ||
      document.visibilityState === "hidden"
    ) {
      finish(element)
      continue
    }
    const kind = element.dataset.reveal
    const transform =
      kind === "media"
        ? "scale(1.025)"
        : kind === "slide"
          ? "translateX(12px)"
          : "translateY(12px)"
    // Siblings that arrive together stagger 60ms apiece, capped at 240ms.
    const delay = Math.min(index, 4) * 60
    index += 1
    const animation = element.animate(
      [
        { opacity: 0, transform },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: 450,
        delay,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      }
    )
    animation.pause()
    animation.onfinish = () => finish(element)
    animations.set(element, animation)
    observer.observe(element)
    pending.add(element)
    let parent = element.parentElement
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY
      if (overflowY === "auto" || overflowY === "scroll") {
        scrollParents.add(parent)
        break
      }
      parent = parent.parentElement
    }
  }
  if (pending.size > 0) {
    for (const target of scrollParents) {
      target.addEventListener("scroll", sweep, { passive: true })
    }
  }

  return () => {
    stop()
    reduced.removeEventListener?.("change", onPreference)
  }
}
