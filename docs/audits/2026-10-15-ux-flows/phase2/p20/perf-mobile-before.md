Profile **mobile**, 3 cold runs per route, medians. 2026-10-16T04:31:05.457Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /team | 50 | 1264 | 1264 | 0.060 | 123 | 101 | 120 | 58 | 479 | 1328 | 473 | 6 | 67 | 563 | 5 | 0 | 5 | 566 |
| /settings/notifications | 43 | 1228 | 1228 | 0.000 | 67 | 95 | – | 57 | 476 | 1306 | 470 | 6 | 65 | 558 | 4 | 0 | 4 | 389 |
| /settings/policy | 52 | 1224 | 1224 | 0.052 | 115 | 95 | 32 | 64 | 514 | 1394 | 508 | 6 | 74 | 596 | 6 | 0 | 6 | 335 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.
