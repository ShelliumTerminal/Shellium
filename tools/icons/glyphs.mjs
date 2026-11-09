// Text -> SVG path data (font outlines), so the mark never depends on installed fonts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

export function font(name) {
  if (!cache.has(name)) {
    const buf = fs.readFileSync(path.join(here, name));
    cache.set(name, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return cache.get(name);
}

/** Path for `text` with its ink box placed so that (cx, baseline) is the horizontal center / baseline. */
export function textPath(fontName, text, size, { cx, baseline, x, letterSpacing = 0 }) {
  const f = font(fontName);
  // lay out glyph by glyph to support letter spacing
  let pen = 0;
  const glyphs = [...text].map((ch) => f.charToGlyph(ch));
  const parts = [];
  glyphs.forEach((g, i) => {
    parts.push({ g, x: pen });
    pen += (g.advanceWidth / f.unitsPerEm) * size + letterSpacing;
    if (i < glyphs.length - 1) pen += (f.getKerningValue(g, glyphs[i + 1]) / f.unitsPerEm) * size;
  });
  const probe = new opentype.Path();
  parts.forEach(({ g, x: gx }) => probe.extend(g.getPath(gx, 0, size)));
  const box = probe.getBoundingBox();
  const left = x !== undefined ? x - box.x1 : cx - (box.x1 + box.x2) / 2;
  const out = new opentype.Path();
  parts.forEach(({ g, x: gx }) => out.extend(g.getPath(left + gx, baseline, size)));
  const b = out.getBoundingBox();
  return { d: out.toPathData(2), box: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } };
}
