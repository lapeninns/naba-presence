import { vi } from "vitest"

/**
 * One deferred that holds the Review details dialog's code. The loader module
 * (components/inbox/detail/review-metadata-loader.ts) is mocked with
 * `heldImport`, so BOTH the preload and the dialog's own load wait on it and
 * settle only when `gate.release()` is called.
 */
const gate = {
  released: Promise.resolve(),
  release: () => {},
}
gate.released = new Promise<void>((resolve) => {
  gate.release = resolve
})

/** The loader's replacement: the real module, once the deferred is released. */
function heldImport() {
  return gate.released.then(
    () =>
      vi.importActual("@/components/inbox/detail/review-metadata") as Promise<
        typeof import("@/components/inbox/detail/review-metadata")
      >
  )
}

export { gate, heldImport }
