Profile **desktop**, 3 cold runs per route, medians. 2026-10-16T04:32:08.198Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /team | 32 | 92 | 92 | 0.128 | 0 | 0 | 32 | 58 | 479 | 1328 | 473 | 6 | 67 | 563 | 5 | 0 | 5 | 548 |
| /settings/notifications | 28 | 84 | 84 | 0.000 | 0 | 0 | 16 | 57 | 476 | 1306 | 470 | 6 | 72 | 558 | 11 | 7 | 4 | 390 |
| /settings/policy | 28 | 84 | 84 | 0.005 | 0 | 0 | 40 | 64 | 514 | 1394 | 508 | 6 | 81 | 598 | 13 | 7 | 6 | 336 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.
