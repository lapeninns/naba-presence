# JetBrains Mono

`JetBrainsMono[wght].ttf` and `JetBrainsMono-Italic[wght].ttf` are the
upstream variable fonts (OFL, `OFL.txt`). They are the source files only:
nothing references them.

`app/layout.tsx` loads the two `-Latin` WOFF2 subsets instead (about 21 KB and
23 KB, against 187 KB and 192 KB for the TTFs). Each keeps the full weight
axis, Basic Latin, Latin-1, general punctuation, currency, arrows and the
keycap symbols (⌘ ⌥ ⌃ ⇧ ↵ ⌫ ⎋), and drops the code ligatures (`calt`), which
counts, timestamps and IDs must not use. Characters outside the subset fall
back to the next font in `--font-mono`.

Regenerate both after changing the source files or the character set
(fontTools with brotli, e.g. `pip install fonttools brotli`):

```sh
U="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2010-2027,U+2030-203A,U+2044,U+20AC,U+2122,U+2190-2195,U+21B5,U+21E7,U+2212,U+2303,U+2318,U+2325,U+232B,U+2326,U+238B,U+23CE,U+25B2-25BC,U+2713,U+2715"
for face in "" "-Italic"; do
  python3 -m fontTools.subset "JetBrainsMono$face[wght].ttf" \
    --unicodes="$U" --layout-features='kern,mark,mkmk,zero,tnum,case,locl' \
    --flavor=woff2 --output-file="JetBrainsMono-Latin$face[wght].woff2"
done
```
