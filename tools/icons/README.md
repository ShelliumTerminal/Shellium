# App icons

Source of the Shellium "Aurora" mark and the OS icon files in `build/`.

The mark is a `>` chevron and a `_` cursor drawn as round strokes in an aurora gradient (cyan
`#22D3EE` -> indigo `#818CF8` -> pink `#F472B6`) on a near-black tile with a violet corner glow
and a soft glow of the same shape behind it. Two variants by size: `small` (16-32 px: no glow,
heavier strokes, larger on the tile) and `full` (48 px and up).

- `mark.py` - the artwork as SVG (`svg(px, variant, idPrefix, margin, shadow)`, `variant_for(px)`).
- `build_page.py` - lays out every needed size on one page (Windows near full bleed, macOS on
  Apple's grid with a shadow, Linux with a small margin) and writes the master SVGs.
- `render.mjs` - renders each size to a transparent PNG with headless Chrome (`CHROME` env var
  for another browser path).
- `pack.py` - packs `out/icon.ico` (PNG entries 16-256), `out/icon.icns` (PNG entries 16-1024) and
  `out/icon.png` (1024).
- `mark-paths.json` - the "Shellium" wordmark (Plus Jakarta Sans ExtraBold, OFL) as outlines, written
  by `export-paths.mjs` with the helper `glyphs.mjs`.

```bash
cd tools/icons
python build_page.py && node render.mjs && python pack.py
cp out/icon.ico out/icon.icns out/icon.png ../../build/
cp shellium-logo.svg ../../build/icon.svg && cp shellium-logo.svg ../../public/shellium-logo.svg
```

Changing the wordmark: put `plus-jakarta-sans-800.woff` here (fontsource,
`@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff`), `npm i opentype.js` in
this folder (both git-ignored), run `node export-paths.mjs`.

The in-app copy is `src/components/common/BrandMark.tsx` (`BrandMark`: same strokes and colors,
glow from 32 px up; `BrandWordmark`: the path from `mark-paths.json`); update it with the artwork.
