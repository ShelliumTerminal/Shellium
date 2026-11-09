"""Lays out every icon PNG that is needed on one transparent page; render.mjs captures each box."""
import io, json, os
from mark import PIXEL, WIN_FULL_SCALE, pixel_svg, svg, variant_for

here = os.path.dirname(os.path.abspath(__file__))
items = []  # (name, size, svg)

# Windows .ico: nearly full bleed; 16-32 drawn on the pixel grid
for s in (16, 20, 24, 32, 40, 48, 64, 128, 256):
    items.append((f"win-{s}", s, pixel_svg(s, "w%d" % s) if s in PIXEL else svg(s, variant_for(s), "w%d" % s, 0.02, scale=WIN_FULL_SCALE)))
# macOS .icns: Apple grid (rounded square ~80 % of the canvas) with a soft shadow on the larger sizes
for s in (16, 32):
    items.append((f"mac-{s}", s, svg(s, "small", "m%d" % s, 0.09)))
for s in (64, 128, 256, 512, 1024):
    items.append((f"mac-{s}", s, svg(s, variant_for(s), "m%d" % s, 0.098, shadow=True)))
# Linux / generic PNG
items.append(("linux-512", 512, svg(512, "large", "l", 0.04)))
items.append(("linux-1024", 1024, svg(1024, "large", "l2", 0.04)))

x, y, rowh, boxes, parts = 0, 0, 0, {}, []
for name, s, markup in items:
    if x + s > 2200:
        x, y, rowh = 0, y + rowh + 8, 0
    parts.append(f'<div style="position:absolute;left:{x}px;top:{y}px;width:{s}px;height:{s}px">{markup}</div>')
    boxes[name] = {"x": x, "y": y, "s": s}
    x += s + 8
    rowh = max(rowh, s)
height = y + rowh
html = f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}</style></head><body style="width:2200px;height:{height}px">' + "".join(parts) + '</body></html>'
io.open(os.path.join(here, "icons.html"), "w", encoding="utf8").write(html)
io.open(os.path.join(here, "boxes.json"), "w", encoding="utf8").write(json.dumps({"height": height, "boxes": boxes}))

# master SVGs for the repo: favicon / build/icon.svg (full card) and the small-size art
io.open(os.path.join(here, "shellium-logo.svg"), "w", encoding="utf8").write(svg(128, "full", "a"))
io.open(os.path.join(here, "shellium-logo-small.svg"), "w", encoding="utf8").write(svg(32, "small", "b"))
print(len(items), "icons, page height", height)
