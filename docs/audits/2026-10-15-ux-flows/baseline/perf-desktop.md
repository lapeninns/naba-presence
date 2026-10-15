Profile **desktop**, 2 cold runs per route, medians. 2026-10-14T23:28:30.005Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 40 | 106 | 106 | 0.000 | 0 | 0 | 40 | 60 | 558 | 1555 | 552 | 6 | 69 | 644 | 5 | 0 | 5 | 506 |
| /inbox?selected={review} | 43 | 110 | 110 | 0.000 | 0 | 0 | – | 60 | 558 | 1555 | 552 | 6 | 69 | 646 | 4 | 0 | 4 | 513 |
| /listings | 33 | 98 | 98 | 0.009 | 0 | 0 | 36 | 58 | 498 | 1456 | 492 | 6 | 66 | 580 | 4 | 0 | 4 | 343 |
| /listings/{loc} | 34 | 94 | 94 | 0.000 | 0 | 0 | 16 | 56 | 496 | 1377 | 490 | 6 | 82 | 582 | 22 | 19 | 3 | 501 |
| /listings/{loc}/hours | 34 | 96 | 992 | 0.001 | 0 | 0 | 16 | 63 | 535 | 1466 | 529 | 6 | 89 | 626 | 22 | 19 | 3 | 528 |
| /listings/{loc}/photos | 36 | 104 | 580 | 0.000 | 0 | 0 | 16 | 57 | 506 | 1404 | 500 | 6 | 83 | 593 | 22 | 19 | 3 | 355 |
| /listings/{loc}/posts | 35 | 102 | 150 | 0.000 | 0 | 0 | 16 | 59 | 537 | 1496 | 531 | 6 | 86 | 626 | 23 | 19 | 4 | 343 |
| /reports | 33 | 94 | 94 | 0.000 | 0 | 0 | 16 | 57 | 499 | 1391 | 493 | 6 | 66 | 589 | 5 | 0 | 5 | 790 |
| /calendar | 36 | 98 | 98 | 0.000 | 0 | 0 | – | 53 | 471 | 1314 | 465 | 6 | 60 | 548 | 3 | 0 | 3 | 233 |
| /clients | 30 | 90 | 90 | 0.000 | 0 | 0 | – | 53 | 457 | 1278 | 428 | 29 | 65 | 539 | 8 | 4 | 4 | 305 |
| /settings | 32 | 96 | 96 | 0.005 | 0 | 0 | 16 | 60 | 507 | 1387 | 501 | 6 | 78 | 590 | 14 | 8 | 6 | 328 |
| /settings/billing | 34 | 96 | 178 | 0.000 | 0 | 0 | – | 63 | 521 | 1439 | 449 | 72 | 84 | 598 | 17 | 14 | 3 | 338 |
| /setup | 29 | 90 | 90 | 0.000 | 0 | 0 | 16 | 54 | 482 | 1354 | 442 | 41 | 64 | 563 | 6 | 3 | 3 | 265 |
| /sign-in | 6 | 64 | 64 | 0.000 | 0 | 0 | 16 | 28 | 254 | 710 | 245 | 8 | 39 | 344 | 7 | 7 | 0 | 117 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.

**Budget breaches (2)**

- /inbox: firstLoadJsTransfer 552 KB > 520
- /inbox?selected={review}: firstLoadJsTransfer 552 KB > 520
