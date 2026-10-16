Profile **desktop**, 2 cold runs per route, medians. 2026-10-16T20:06:34.590Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 41 | 100 | 100 | 0.000 | 0 | 0 | 40 | 68 | 558 | 1521 | 519 | 39 | 77 | 644 | 5 | 0 | 5 | 517 |
| /inbox?selected={review} | 34 | 96 | 96 | 0.000 | 0 | 0 | – | 67 | 554 | 1512 | 519 | 35 | 76 | 642 | 4 | 0 | 4 | 532 |
| /listings | 30 | 90 | 90 | 0.023 | 0 | 0 | – | 63 | 510 | 1466 | 504 | 6 | 71 | 591 | 4 | 0 | 4 | 329 |
| /listings/{loc} | 32 | 96 | 96 | 0.001 | 0 | 0 | 16 | 67 | 525 | 1423 | 519 | 6 | 74 | 611 | 3 | 0 | 3 | 517 |
| /listings/{loc}/hours | 31 | 88 | 1358 | 0.001 | 0 | 0 | 24 | 72 | 551 | 1481 | 545 | 6 | 79 | 640 | 3 | 0 | 3 | 484 |
| /listings/{loc}/photos | 32 | 88 | 858 | 0.001 | 0 | 0 | 24 | 68 | 527 | 1425 | 521 | 6 | 75 | 615 | 3 | 0 | 3 | 382 |
| /listings/{loc}/posts | 40 | 100 | 100 | 0.001 | 0 | 0 | 24 | 72 | 562 | 1523 | 556 | 6 | 80 | 648 | 4 | 0 | 4 | 372 |
| /listings/{loc}/profile | 57 | 130 | 130 | 0.116 | 0 | 0 | 24 | 78 | 621 | 1764 | 594 | 27 | 90 | 719 | 8 | 0 | 8 | 909 |
| /listings/{loc}/menu | 30 | 86 | 858 | 0.001 | 0 | 0 | 24 | 71 | 549 | 1479 | 543 | 6 | 78 | 636 | 3 | 0 | 3 | 360 |
| /listings/{loc}/booking | 31 | 80 | 80 | 0.017 | 0 | 0 | 24 | 70 | 538 | 1455 | 532 | 6 | 78 | 626 | 4 | 0 | 4 | 404 |
| /listings/{loc}/people | 36 | 92 | 92 | 0.001 | 0 | 0 | 24 | 69 | 571 | 1581 | 565 | 6 | 78 | 661 | 5 | 0 | 5 | 443 |
| /listings/{loc}/verification | 32 | 90 | 90 | 0.001 | 0 | 0 | 24 | 69 | 571 | 1581 | 565 | 6 | 78 | 661 | 5 | 0 | 5 | 432 |
| /listings/{loc}/suggestions | 38 | 96 | 96 | 0.001 | 0 | 0 | 24 | 65 | 510 | 1388 | 504 | 6 | 72 | 596 | 3 | 0 | 3 | 350 |
| /listings/{loc}/changes | 31 | 88 | 88 | 0.001 | 0 | 0 | 24 | 70 | 534 | 1442 | 526 | 9 | 86 | 633 | 12 | 2 | 10 | 325 |
| /reports | 29 | 88 | 88 | 0.000 | 0 | 0 | 16 | 67 | 525 | 1432 | 519 | 6 | 76 | 615 | 5 | 0 | 5 | 750 |
| /calendar | 25 | 70 | 70 | 0.000 | 0 | 0 | – | 57 | 482 | 1330 | 476 | 6 | 66 | 561 | 5 | 2 | 3 | 246 |
| /clients | 26 | 80 | 80 | 0.000 | 0 | 0 | – | 61 | 483 | 1321 | 454 | 29 | 73 | 565 | 8 | 4 | 4 | 287 |
| /settings | 30 | 90 | 90 | 0.000 | 0 | 0 | 16 | 65 | 520 | 1410 | 512 | 8 | 82 | 605 | 13 | 8 | 5 | 328 |
| /settings/notifications | 27 | 82 | 82 | 0.000 | 0 | 0 | 16 | 58 | 481 | 1316 | 475 | 6 | 72 | 563 | 10 | 7 | 3 | 389 |
| /team | 34 | 96 | 96 | 0.000 | 0 | 0 | 36 | 58 | 484 | 1339 | 478 | 6 | 65 | 570 | 3 | 0 | 3 | 548 |
| /settings/billing | 26 | 88 | 88 | 0.000 | 0 | 0 | – | 66 | 533 | 1447 | 527 | 6 | 73 | 612 | 3 | 0 | 3 | 259 |
| /setup | 27 | 84 | 84 | 0.000 | 0 | 0 | 16 | 62 | 502 | 1378 | 461 | 41 | 72 | 583 | 6 | 3 | 3 | 277 |
| /sign-in | 5 | 56 | 56 | 0.000 | 0 | 0 | 16 | 38 | 298 | 811 | 285 | 13 | 49 | 389 | 7 | 7 | 0 | 119 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.

**Budget breaches (9)**

- /listings/{loc}/profile: cls 0.116 > 0.1
- /listings/{loc}/profile: firstLoadJsTransfer 594 KB > 520
- /listings/{loc}/menu: firstLoadJsTransfer 543 KB > 520
- /listings/{loc}/booking: firstLoadJsTransfer 532 KB > 520
- /listings/{loc}/people: firstLoadJsTransfer 565 KB > 520
- /listings/{loc}/verification: firstLoadJsTransfer 565 KB > 520
- /listings/{loc}/changes: firstLoadJsTransfer 526 KB > 520
- /settings/billing: firstLoadJsTransfer 527 KB > 520
- /sign-in: firstLoadJsTransfer 285 KB > 260
