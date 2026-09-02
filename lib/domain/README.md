# lib/domain

Pure business rules shared by the server, the route contracts and (where
client-safe) the browser bundle.

## Client-safety convention

- A module that imports `node:crypto` (or anything else from `node:*` /
  `server-only`) is **server-only**: `hours.ts`, `profile.ts`,
  `food-menus.ts`.
- Its pure vocabulary — constants, enums, types and normalisers that do not
  hash — lives in a sibling **`*-vocabulary.ts`** module with no Node
  imports: `hours-vocabulary.ts`, `profile-vocabulary.ts`,
  `food-menus-vocabulary.ts`, `import-review-vocabulary.ts`.
- The server-only module `export *`s its vocabulary, so server code keeps
  importing from `hours.ts` / `profile.ts` / `food-menus.ts` unchanged.
- `lib/contracts/*` and anything reachable from a client component must
  import from the `*-vocabulary.ts` module (or another client-safe domain
  module such as `import-review.ts`, `food-menu-import.ts`,
  `google-contract.ts`), never from a server-only one.
  `tests/contracts-client-safe.test.ts` walks the import graph of every
  contract and fails if a `node:*` or `server-only` import becomes reachable.
