Profile **desktop**, 3 cold runs per route, medians. 2026-10-16T04:35:42.069Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /team | 32 | 96 | 96 | 0.000 | 0 | 0 | 40 | 57 | 480 | 1333 | 474 | 6 | 64 | 566 | 3 | 0 | 3 | 548 |
| /settings/notifications | 31 | 92 | 92 | 0.000 | 0 | 0 | 16 | 57 | 476 | 1306 | 470 | 6 | 71 | 559 | 10 | 7 | 3 | 389 |
| /settings/policy | 33 | 96 | 96 | 0.000 | 0 | 0 | 40 | 64 | 516 | 1401 | 510 | 6 | 80 | 600 | 12 | 7 | 5 | 336 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.
