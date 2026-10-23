import { describe, expectTypeOf, it } from "vitest"

import type {
  GooglePerformancePoint,
  GooglePlaceActionLink,
  GoogleSearchKeywordPoint,
} from "@/lib/server/google"

/** `T` with every `readonly` modifier removed. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

// Checked by `pnpm typecheck` (tests are in tsconfig): legacy consumers
// update fields on these response values, so none of them may become
// readonly in the public compatibility facade.
describe("Google provider public types", () => {
  it("keeps legacy response fields mutable", () => {
    expectTypeOf<GooglePerformancePoint>().toEqualTypeOf<
      Mutable<GooglePerformancePoint>
    >()
    expectTypeOf<GoogleSearchKeywordPoint>().toEqualTypeOf<
      Mutable<GoogleSearchKeywordPoint>
    >()
    expectTypeOf<GooglePlaceActionLink>().toEqualTypeOf<
      Mutable<GooglePlaceActionLink>
    >()
  })
})
