Profile **mobile**, 5 cold runs per route, medians. 2026-10-19T00:20:24.469Z against http://127.0.0.1:62272.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 21 | 1244 | 1244 | 0.001 | 43 | 78 | 16 | 67 | 562 | 1535 | 507 | 54 | 74 | 647 | 3 | 0 | 3 | 433 |
| /listings | 17 | 1240 | 1240 | 0.000 | 46 | 81 | 16 | 65 | 516 | 1480 | 510 | 6 | 72 | 597 | 3 | 0 | 3 | 332 |
| /listings/{loc}/profile | 23 | 1228 | 1228 | 0.045 | 66 | 84 | 16 | 80 | 627 | 1776 | 586 | 40 | 92 | 725 | 8 | 0 | 8 | 874 |

Times in ms. INP probe = longest observed Event Timing/first-input duration attributed to one tap/click, not field INP.

Every requested cold run has valid navigation, quiet-window and interaction evidence.

All budgets met.
