Profile **mobile**, 5 cold runs per route, medians. 2026-10-18T22:13:50.161Z against http://127.0.0.1:58849.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 23 | 1256 | 1256 | 0.001 | 58 | 85 | 16 | 66 | 556 | 1522 | 523 | 33 | 73 | 642 | 3 | 0 | 3 | 432 |
| /listings | 20 | 1248 | 4000 | 0.015 | 69 | 87 | 96 | 65 | 515 | 1476 | 509 | 6 | 73 | 598 | 4 | 0 | 4 | 334 |
| /listings/{loc}/profile | 29 | 1252 | 1256 | 0.045 | 109 | 101 | 16 | 78 | 624 | 1772 | 596 | 27 | 90 | 722 | 8 | 0 | 8 | 874 |

Times in ms. INP probe = longest observed Event Timing/first-input duration attributed to one tap/click, not field INP.

Every requested cold run has valid navigation, quiet-window and interaction evidence.

**Budget breaches (3)**

- /inbox: firstLoadJsTransfer 523 KB > 520
- /listings: lcp 4000 > 1500
- /listings/{loc}/profile: firstLoadJsTransfer 596 KB > 520
