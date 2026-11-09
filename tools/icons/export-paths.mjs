// Writes mark-paths.json: the "Shellium" wordmark as outlines (Plus Jakarta Sans ExtraBold, OFL).
// Needs plus-jakarta-sans-800.woff and opentype.js in this folder (both git-ignored); see README.
import fs from "node:fs";
import { textPath } from "./glyphs.mjs";

const t = textPath("plus-jakarta-sans-800.woff", "Shellium", 64, { x: 0, baseline: 64, letterSpacing: -0.5 });
if (t.d.includes("NaN")) throw new Error("NaN in the wordmark path");
const out = {
  note: "Shellium Aurora mark (viewBox 0 0 120 120): a > chevron and _ cursor with an aurora gradient. Wordmark: Plus Jakarta Sans ExtraBold (OFL) outlines, generated once by export-paths.mjs.",
  wordmark: { d: t.d, width: +t.box.x2.toFixed(2), top: +t.box.y1.toFixed(2), bottom: +t.box.y2.toFixed(2) },
};
fs.writeFileSync(new URL("./mark-paths.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wordmark", out.wordmark.width, out.wordmark.top, out.wordmark.bottom);
