/**
 * Scroll reveals for the prototype page.
 *
 * CSS keeps every element visible by default: this only hides a group that is
 * still below the fold, plays it once, and never touches it again. Anything
 * already on screen at mount (or after a reload at a restored scroll
 * position) stays visible, so there is no visible-hidden-visible flicker.
 */
export function installReferenceReveals(root: ParentNode = document) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  const animations = new Map<Element, Animation>()
  const elements = [...root.querySelectorAll<HTMLElement>("[data-reveal]")]

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
          { threshold: 0, rootMargin: "0px 0px 96px 0px" }
        )
      : undefined

  const stop = () => {
    observer?.disconnect()
    elements.forEach(finish)
  }
  const onPreference = () => {
    if (reduced.matches) stop()
  }
  reduced.addEventListener("change", onPreference)

  for (const element of elements) {
    if (element.dataset.revealPlayed === "true") continue
    const rect = element.getBoundingClientRect()
    if (
      reduced.matches ||
      !observer ||
      !element.animate ||
      rect.top < innerHeight ||
      document.visibilityState === "hidden"
    ) {
      finish(element)
      continue
    }
    const kind = element.dataset.reveal
    const transform =
      kind === "media"
        ? "scale(1.02)"
        : kind === "slide"
          ? "translateX(-12px)"
          : "translateY(12px)"
    const delay = Number(element.dataset.revealDelay ?? 0)
    const animation = element.animate(
      [
        { opacity: 0, transform },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: 480,
        delay,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      }
    )
    animation.pause()
    animation.onfinish = () => finish(element)
    animations.set(element, animation)
    observer.observe(element)
  }

  return () => {
    stop()
    reduced.removeEventListener("change", onPreference)
  }
}

/**
 * The load entrance: toolbar, queue column and inspector settle into the
 * layout they have already painted. Transform and opacity only, so nothing
 * is hidden while fonts or data resolve.
 */
export function playEntrance(elements: (HTMLElement | null)[], offset = 12) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {}
  const played: Animation[] = []
  elements.forEach((element, index) => {
    if (!element?.animate) return
    played.push(
      element.animate(
        [
          { opacity: 0, transform: `translateY(${offset}px)` },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 520,
          delay: index * 80,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "backwards",
        }
      )
    )
  })
  return () => played.forEach((animation) => animation.cancel())
}
