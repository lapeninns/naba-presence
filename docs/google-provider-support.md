# Google provider support catalogue

Version: `2026-09-29.1`. Documentation checked: 2026-09-29.
Implementation and verification status: [acceptance register](gbp-operations-acceptance.md).

The executable catalogue covers retired resources, Business Information fields,
the pinned lodging payload schema, and a resource/action catalogue versioned
`2026-09-30.1`. Per-action eligibility producers, dynamic attribute-field
metadata, all remaining editable-field catalogues and complete UI/action
integration are still in progress.
This document does not claim M0 or specialist coverage complete.

## Source and runtime boundaries

- `lib/domain/google-support.ts` owns retired provider methods and stored-resource
  mappings. `lib/server/google/transport.ts` rejects those endpoints before quota
  acquisition, token use or proxy/network dispatch.
- `lib/domain/google-capabilities.ts` owns the Business Information field
  classifications, methods, eligibility sources, documentation references and
  projection. The business-information response adds optional
  `capabilityDetails`; older consumers continue to parse the original fields.
- `lib/domain/google-resource-catalogue.ts` records documented read/write actions
  for Business Information, creation, category/chain/matching discovery,
  attributes, lodging/suggestions, accounts/access/invitations/transfer,
  verification, reviews, posts, merchant/customer media, menus, place actions,
  performance/keywords and notifications. It includes every retired method
  without collapsing duplicate action names and an explicit retail-product
  Google handoff. Primary REST family/resource references were checked on
  2026-09-30. The retail handoff is an inference from the absence of a retail
  product-catalogue resource in the current GBP API reference, not a claim that
  this client has another Google product integration.
- Location capabilities retain the original surface map and add optional
  `resourceActions`. This projection rechecks active linked-account/connection
  state and current app grants. It does not obtain provider eligibility on that
  local route: observations remain unknown and sends remain `canWrite=false`
  until a domain-specific authoritative producer supplies positive evidence.
  Read access can remain available to acquire that evidence. Account/access/
  verification actions additionally require an app owner/admin. The new detail
  is advisory and does not replace exact approved-write preflight.
- `support` describes provider API availability. `eligibility` describes the
  available evidence for this listing and is independently `eligible`,
  `ineligible`, `unknown` or `not_applicable`.
- `canValidate` permits a validation request under local permissions and flags.
  It does not prove Google acceptance. `canWrite` requires positive eligibility
  evidence as well as local permission. Ordinary fields remain eligibility
  unknown until a specific payload passes Google's validation; the existing
  validate-only/publish flow remains authoritative for that payload.
- `documentationCheckedAt` is the catalogue's documentation-check date.
  `observedAt` is when the successful location read used by this response was
  observed. It is not a public Search/Maps confirmation timestamp.
- Service writes re-read the location and its hash before checking the catalogue's
  `canModifyServiceList` metadata flag. Missing/non-boolean flags are unknown,
  explicit false is ineligible, and true is eligible. Neither unknown nor
  ineligible creates a mutation attempt or provider write.

## Classified families

| Family | Provider support | Source |
| --- | --- | --- |
| Business Information | Documented location fields use `locations.patch`, subject to payload validation and category/location restrictions | [Location API](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations) |
| General services, including eligible healthcare businesses | `serviceItems` through Business Information; structured IDs come from category metadata and full-list replacement requires preserving siblings | [Services guide](https://developers.google.com/my-business/content/services) |
| Metadata and reopening eligibility | Read-only provider observations | [Location field reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations) |
| Location language and service-area home region | Immutable after creation | [Location field reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations) |
| Coordinates | Restricted to Google-approved clients; current app catalogue offers a Google handoff rather than claiming this client is approved | [Location API](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations) |
| Business Calls | Retired; historical data only. Call-click performance metrics are a separate family | [Deprecation schedule](https://developers.google.com/my-business/content/sunset-dates) |
| Healthcare provider attributes and insurance networks | Retired; no new provider requests or editing promises | [Deprecation schedule](https://developers.google.com/my-business/content/sunset-dates) |
| Q&A and legacy location association | Retired; no new provider requests | [Deprecation schedule](https://developers.google.com/my-business/content/sunset-dates) |
| Legacy location and post insights | Retired; old `accounts.locations.reportInsights` and `accounts.locations.localPosts.reportInsights` requests are denied. Current Performance API metrics remain a separate supported resource | [Deprecation schedule](https://developers.google.com/my-business/content/sunset-dates) |

The retirement catalogue was extended on 2026-09-30 after rechecking the
deprecation schedule. Location insights discontinued on 2023-03-30 and post
insights on 2023-02-20. Transport regressions first reproduced both old routes
reaching the local provider stub, then proved stable 410 denial with zero network
requests. The supported `fetchMultiDailyMetricsTimeSeries` route still crosses
the shared HTTP transport and safely retries a transient read failure. This
increment also tests the legacy Q&A answer route, which the existing guard denies.

## Lodging schema boundary

`lib/domain/google-lodging-schema.json` pins structural discovery metadata from
[Google Lodging v1](https://mybusinesslodging.googleapis.com/$discovery/rest?version=v1),
revision `20260928`, checked on 2026-09-29. `lib/contracts/google-lodging.ts`
defines the corresponding shared Zod patch payload. The industry endpoint uses
this schema and the writable update paths projected by
`lib/domain/google-lodging.ts`.

Absent fields stay absent. Boolean false and provider exception enums are
preserved. Unknown properties and invalid primitive/enum values fail validation
instead of being stripped. Resource identity is server-owned; Google's
`allUnits` and `someUnits` aggregates are read-only. Repeated resources are
replaced as a whole; masks cannot address an array index or an item property.
Guest-unit identifiers must be present and unique; repeated language and
certification entries retain their required identifiers. Masked omission can
represent clearing, while an omitted unmasked field remains unchanged.

This is local structural validation of a partial update. It does not establish
listing eligibility, validate business claims or prove Google acceptance.
Lodging now binds exact approval and its required assertion timestamp and uses
independent readback. The complete typed editor and eligible-account acceptance
remain programme work.
The schema-preservation test is not an editor-coverage test. A new provider
field requires a reviewed catalogue/schema update before this endpoint can
publish a parent object containing it.

## Services wire contract

`lib/domain/google-services.ts` follows Business Information v1 discovery
revision `20260928`, inspected on 2026-09-29, and the
[REST ServiceItem reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#ServiceItem).
Each item contains exactly one `structuredServiceItem` or `freeFormServiceItem`.
The latter uses `category`, not `categoryId`. The current discovery schema does
not expose `isOffered`; the older examples in the
[service guide](https://developers.google.com/my-business/content/services)
include that field and a different category key. The mutation contract follows
the discovery/REST shape and rejects unsupported fields rather than dropping them.

Prices preserve integer-string units without floating-point conversion and
validate int64 range, nanos range and sign consistency. Optional values remain
absent; explicit zero is preserved. Structured descriptions have Google's
300-character limit. Free-form name/description recommendations are not treated
as undocumented hard limits.

The existing Business Information mutation now validates this shared contract.
Service eligibility and stale-baseline checks still apply. A location-scoped
`?type=services` read obtains the current category IDs and requests their FULL
metadata through `categories:batchGet`. The response carries its location hash,
observation time, language and region. Missing categories or incomplete metadata
produce explicit errors rather than an empty eligibility claim.

Nonempty service writes re-read the same metadata before creating an attempt.
Changed structured IDs must be supported; changed custom services must belong
to a selected category. Exact unchanged existing services can remain even when
their type is no longer advertised. A concurrent category edit disables that
exception so all proposed services must fit the proposed categories.
The linked-location service editor supports whole-list preservation and exact
service approvals. Structural validation and category matching are not Google
acceptance; provider confirmation and eligible live acceptance remain separate.

Onboarding service discovery now reads the saved draft's proposed categories
without requiring a linked location. Its response is bound to draft revision and
payload hash, and carries language, region and observation time. Account access
is freshly verified and local scope/revision is rechecked after discovery.
Nonempty new-listing service proposals have no unchanged-service exemption:
fresh metadata must support their structured IDs or custom-service categories
before validation and again before creation is claimed. Setup service-entry
controls now use this metadata for suggested IDs and custom categories, and
preserve sibling services, optional values and precise prices. The frozen
creation review includes service details; live acceptance remains pending.
This uses the current
[categories.batchGet contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/categories/batchGet),
checked 2026-09-29; responses may reorder categories, so completeness is checked
by provider ID rather than response position.

## Relationships and chain discovery

The Business Information discovery schema revision `20260928`, checked on
2026-09-29, marks `RelationshipData.parentChain`, `parentLocation` and
`childrenLocations` as writable optional fields. Each related location requires
an exact place ID and either `DEPARTMENT_OF` or
`INDEPENDENT_ESTABLISHMENT_IN`; unspecified relationship types are excluded
from editable proposals. See the
[RelationshipData reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#RelationshipData)
and [current discovery schema](https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1).

Chain choices use the supported Business Information
[chains.search method](https://developers.google.com/my-business/reference/businessinformation/rest/v1/chains/search),
checked 2026-09-29. It accepts `chainName` and `pageSize`; results use exact
`chains/{id}` resource names. The existing shared transport requests up to 100
results. Onboarding uses this transport with fresh account proof, saved-draft
revision/hash binding and scope rechecks. Malformed or duplicate chain identities
are rejected. Search discovery does not establish affiliation or publish it;
Google creation validation, exact approval and independent readback remain
required. Parent/child format checks likewise do not establish provider acceptance.

## Hours readback and midnight

The Business Information discovery schema revision `20260928`, checked on
2026-09-29, explicitly describes proto3 zero omission: midnight TimeOfDay values
can appear as `{}`. An omitted hour with a supplied minute likewise represents
that minute after midnight. The shared normalizer preserves these provider values
for regular, special and additional hours. A missing time object remains missing,
and invalid hours/minutes are rejected. The provider permits `24:00` as midnight
at the end of the specified day. See the
[TimePeriod reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#TimePeriod)
and [current discovery schema](https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1).

Creation drafts now accept typed `regularHours` and `specialHours` proposals.
Special hours require regular hours, and an open special period must last less
than 24 hours, with an end date equal to the start or the following date. A
following-date close must be before noon. When `closed=true`, the provider ignores
end date and times; the creation contract omits them before review and publication.
Readback compares the approved period set while permitting provider ordering and
omitted zero/false defaults. Supported API structure and passing fixture tests do
not establish live acceptance. See the
[SpecialHourPeriod reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#SpecialHourPeriod),
checked 2026-09-29 against discovery revision `20260928`.

Creation `moreHours` proposals use exact `hoursTypeId` values supplied by category
`moreHoursTypes` metadata. The saved-draft discovery endpoint retains these types
and labels; validation and creation refresh support across all selected categories.
There is no hardcoded type enumeration or conversion from a display label. One
schedule per type is enforced, while different services may have overlapping hours.
Independent readback matches exact type identities and period sets, accepting
reordering and omitted midnight zero fields. Unsupported types block creation;
missing or changed schedules remain unresolved. The controls preserve saved
schedules during metadata failure and distinguish failed discovery from a valid
empty type list. See the
[MoreHours reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#MoreHours)
and [MoreHoursType reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#MoreHoursType),
checked 2026-09-29. Local fixture evidence does not establish live eligibility.

## Historical data and recovery

### Lifecycle semantics checked 2026-09-30

The [locations.transfer reference](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/locations/transfer)
requires ownership of the source account and at least manager access to the
destination account. Its empty success body is acknowledgement; independent
confirmation needs complete source/destination membership reads and the exact
location identity. Disappearing from the source or losing permission alone does
not establish a transfer.

Business Information discovery revision `20260928` still exposes output-only
`metadata.canDelete`. Deletion eligibility must be explicitly observed. A
successful provider deletion request does not establish removal from Search or
Maps, or deletion of customer reviews. See [Google's account-removal guidance](https://support.google.com/business/answer/4669092).
The new lifecycle contract/domain foundation has seven passing local cases for
these distinctions; its review, execution, recovery and UI integration remain
unfinished. It has not performed any provider lifecycle write.

The same current discovery marks `metadata.canOperateLocalPost` deprecated and
no longer populated. The resource catalogue's existing post eligibility wording
still needs correction and integration with current provider evidence; do not
treat a missing value as confirmed post ineligibility. This is an open WP1/WP9
item, not live eligibility evidence.

Existing snapshot and attempt retention/legal-hold rules remain in effect.
Retired attempts retain their original execution status; activity adds a
`historicalReason` explaining retirement rather than rewriting a historical
success as a present-day failure. No retry control is introduced for them.
Compatibility mutation requests receive `provider_capability_retired` and must
not be queued for automatic retries.

When service eligibility is unknown, refresh Business Information. When Google
explicitly reports ineligibility, use a supported category/business workflow;
do not override the flag or fabricate a category to enable editing. When the
baseline changed, regenerate the review instead of reusing its approval.
