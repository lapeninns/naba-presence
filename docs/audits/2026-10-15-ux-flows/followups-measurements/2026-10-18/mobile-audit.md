# Mobile quality audit

Base http://127.0.0.1:63270 · widths 320, 390, 1280 · themes light, dark · 180 page loads · 162s

## Totals

| Metric | Count |
| --- | --- |
| pages | 180 |
| loadErrors | 0 |
| horizontalOverflow | 0 |
| clippedText | 4 |
| targetSize | 0 |
| touchTargetBelow44 | 20 |
| touchBoxBelow44 | 271 |
| iosZoomInputs | 0 |
| textUnder12 | 0 |
| textUnder14Phone | 1863 |
| axeViolations | 0 |
| axeNodes | 0 |
| axeCritical | 0 |
| axeSerious | 0 |
| focusObscured | 0 |
| chromeOver25Pct | 0 |
| mainLandmarkNot1 | 0 |
| h1Not1 | 0 |
| missingSkipLink | 0 |
| consoleErrors | 0 |
| pageErrors | 0 |
| phoneChromeMaxPct | 20.4 |
| smallestTextPx | 12 |
| maxOverflowPx | 0 |

## Per route (summed over widths and themes)

| Route | horizontalOverflow | targetSize | touchTargetBelow44 | touchBoxBelow44 | iosZoomInputs | textUnder12 | axeNodes | focusObscured | chromeOver25Pct | consoleErrors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| /inbox | 0 | 0 | 4 | 27 | 0 | 0 | 0 | 0 | 0 | 0 |
| /inbox?selected={review} | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings | 0 | 0 | 3 | 13 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc} | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/hours | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/profile | 0 | 0 | 6 | 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/photos | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/posts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/menu | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/booking | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/people | 0 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/suggestions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/verification | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/changes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/bulk | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients | 0 | 0 | 3 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients/{client} | 0 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients/{client}/settings | 0 | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients/new | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /calendar | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /reports | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| /notifications | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /team | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/connections | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/notifications | 0 | 0 | 0 | 54 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/security | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/privacy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/operations | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/billing | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/usage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /setup | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| anon:/sign-in | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| anon:/forgot-password | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| anon:/privacy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| viewer:/inbox | 0 | 0 | 4 | 21 | 0 | 0 | 0 | 0 | 0 | 0 |

## Top offenders: touch targets below 44px, effective hit area (phones)

| Component | Count | Routes | Example | Size/By |
| --- | --- | --- | --- | --- |
| [data-slot=input] | 15 | 5 | input[data-slot=input].h-full.min-w-0 | 143x42 |
| input in [data-slot=tag-input] | 3 | 1 | input#profile-labels.h-7.min-w-[8ch] | 266x28 |
| [data-slot=filter-chip] | 2 | 2 | button[data-slot=filter-chip].group/chip.relative | 85.5x28 |

## Top offenders: drawn boxes below 44px, ignoring hit-area extensions (phones)

| Component | Count | Routes | Example | Size/By |
| --- | --- | --- | --- | --- |
| [data-slot=switch] | 75 | 2 | span#base-ui-_r_9_[data-slot=switch][role=switch].group/switch.relative | 36x20 |
| [data-slot=button] | 54 | 6 | button[data-slot=button].group/button.relative | 169.1x36 |
| [data-slot=filter-chip] | 54 | 5 | button[data-slot=filter-chip].group/chip.relative | 51x28 |
| [data-slot=card-link] | 24 | 1 | a[data-slot=card-link].text-ink.no-underline | 20x20 |
| [data-slot=list-row-actions-trigger] | 18 | 2 | button#base-ui-_R_3d6kkolfivbknmlb_[data-slot=list-row-actions-trigger].group/button.relative | 36x36 |
| [data-slot=input] | 15 | 5 | input[data-slot=input].h-full.min-w-0 | 143x42 |
| [data-slot=dropdown-menu-trigger] | 9 | 2 | button#base-ui-_r_9_[data-slot=dropdown-menu-trigger].group/button.relative | 36x36 |
| a in [data-slot=page-frame] | 6 | 2 | a.group/button.relative | 220.3x36 |
| a in [data-slot=table-cell] | 4 | 1 | a.inline-flex.min-h-(--np-control-h) | 180.5x24 |
| [data-slot=checkbox] | 3 | 1 | span#base-ui-_r_7_[data-slot=checkbox][role=checkbox].relative.flex | 18x18 |
| [data-slot=order-chip] | 3 | 1 | button#base-ui-_R_3cot5fivbknmlb_[data-slot=order-chip].group/chip.relative | 113x28 |
| a in [data-slot=card-content] | 3 | 1 | a.group/button.relative | 170.5x36 |
| input in [data-slot=tag-input] | 3 | 1 | input#profile-labels.h-7.min-w-[8ch] | 266x28 |

## Top offenders: clipped text without full value

| Component | Count | Routes | Example | Size/By |
| --- | --- | --- | --- | --- |
| span in [data-slot=action-bar-status] | 3 | 1 | span |  |
| span in [data-slot=inbox-list-header] | 1 | 1 | span.text-caption.tabular-nums |  |

