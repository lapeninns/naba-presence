import { vi } from "vitest"

/**
 * One deferred that holds the template dialog's code, for the tests of the
 * batch while that code is on the way. The loader module
 * (components/inbox/template-dialog-loader.ts) is mocked with `heldImport`, so
 * BOTH the preload and the dialog's own load wait on it and settle only when
 * `gate.release()` is called. (Holding the dialog module itself with an async
 * mock factory does not: a second import made while the factory is still
 * waiting is handed the real module straight away.)
 */
const gate = {
  released: Promise.resolve(),
  release: () => {},
  /** Every import handed out since the last reset, so a test can wait for the code. */
  imports: [] as Promise<unknown>[],
  /** A new, unreleased deferred: every scenario starts with the code on the way. */
  reset() {
    gate.imports = []
    gate.released = new Promise<void>((resolve) => {
      gate.release = resolve
    })
  },
}
gate.reset()

/** The loader's replacement: the real module, once the deferred is released. */
function heldImport() {
  const loaded = gate.released.then(
    () =>
      vi.importActual("@/components/inbox/template-reply-dialog") as Promise<
        typeof import("@/components/inbox/template-reply-dialog")
      >
  )
  gate.imports.push(loaded)
  return loaded
}

export { gate, heldImport }
