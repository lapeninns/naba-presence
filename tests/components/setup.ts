import "@testing-library/jest-dom/vitest"

import { Blob as NodeBlob, File as NodeFile } from "node:buffer"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// The jsdom environment installs its own window.Blob/File onto globalThis,
// shadowing Node's spec-compliant (undici-compatible) versions. jsdom's Blob
// has no .stream(), so constructing a Response from one (as download-trigger
// code + its tests do) throws "object.stream is not a function". Node's
// Blob/File are a superset of the DOM API surface jsdom needs, so restoring
// them is safe and makes fetch Response/Blob interop work under jsdom.
globalThis.Blob = NodeBlob as unknown as typeof Blob
globalThis.File = NodeFile as unknown as typeof File

// @testing-library/react's own auto-cleanup only registers itself when it
// finds a global `afterEach` at import time (see its dist/index.js). This
// project's vitest config does not set `test.globals: true`, so no such
// global exists and that auto-registration silently no-ops — renders from
// one `it()` leak into the next `it()` in the same file. Register cleanup
// explicitly so every component test starts from an empty document body.
afterEach(cleanup)

// jsdom implements no ResizeObserver, and cmdk (the command palette) observes
// its own list to keep the selected item scrolled into view. Without this the
// palette throws on mount and takes the whole tree with it, so every test
// that renders the shell would fail for a reason unrelated to what it asserts.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// Same reason: jsdom lays nothing out, so it implements no scrollIntoView.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
