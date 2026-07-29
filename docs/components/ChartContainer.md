---
category: Data Display
---

Recharts wrapper that binds series to the DS chart tokens.

Pass a `config` mapping each series key to a label and colour, using the `--chart-1`…`--chart-5` tokens. Compose `ChartTooltip`/`ChartTooltipContent` and `ChartLegend`/`ChartLegendContent` instead of Recharts' defaults. Chart colours carry no contrast guarantee — always label series rather than relying on hue alone.

## Parts

Composed inside `<ChartContainer>`, each importable from `window.NabaPresence.*`:

- `ChartLegend`
- `ChartLegendContent`
- `ChartStyle`
- `ChartTooltip`
- `ChartTooltipContent`
