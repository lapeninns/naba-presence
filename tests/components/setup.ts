import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// @testing-library/react's own auto-cleanup only registers itself when it
// finds a global `afterEach` at import time (see its dist/index.js). This
// project's vitest config does not set `test.globals: true`, so no such
// global exists and that auto-registration silently no-ops — renders from
// one `it()` leak into the next `it()` in the same file. Register cleanup
// explicitly so every component test starts from an empty document body.
afterEach(cleanup)
