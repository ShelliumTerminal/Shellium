"""Shellium "Aurora" mark: a > chevron and a _ cursor in an aurora gradient (cyan -> indigo -> pink)
on a near-black tile, with a soft glow of the same shape behind it.

Geometry is a few strokes in a 120 x 120 viewBox, so no font is needed here. Variants by size:
small (16-32 px: no glow, heavier strokes, larger on the tile so it stays crisp) and full (48 px
and up). "large" is kept as an alias of full for build_page.py.
"""

TILE_TOP, TILE_BOTTOM, GLOW = "#16162A", "#05050C", "#8B5CF6"
AURORA = ("#22D3EE", "#818CF8", "#F472B6")
STROKE = {"small": 18.0, "full": 16.0}
SCALE = {"small": 0.86, "full": 0.78}
# Windows icons from 40 px up: a larger >_ (the taskbar shows it next to full-bleed icons)
WIN_FULL_SCALE = 0.98


def defs(p, size):
    a, b, c = AURORA
    out = (f'<linearGradient id="{p}tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{TILE_TOP}"/>'
           f'<stop offset="1" stop-color="{TILE_BOTTOM}"/></linearGradient>'
           f'<radialGradient id="{p}tg" cx=".3" cy=".18" r=".9"><stop offset="0" stop-color="{GLOW}" stop-opacity=".35"/>'
           f'<stop offset="1" stop-color="{GLOW}" stop-opacity="0"/></radialGradient>'
           f'<linearGradient id="{p}au" x1="30" y1="30" x2="94" y2="92" gradientUnits="userSpaceOnUse">'
           f'<stop offset="0" stop-color="{a}"/><stop offset=".5" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></linearGradient>'
           f'<filter id="{p}shadow" x="-20%" y="-20%" width="140%" height="150%">'
           f'<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity=".35"/></filter>')
    if size != "small":
        out += f'<filter id="{p}bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>'
    return out


def glyph(p, size, extra=""):
    w = STROKE[size]
    return (f'<g fill="none" stroke="url(#{p}au)" stroke-linecap="round" stroke-linejoin="round"{extra}>'
            f'<path d="M32 34 L62 60 L32 86" stroke-width="{w}"/><path d="M70 86 H92" stroke-width="{w}"/></g>')


def body(p, size, scale=None):
    size = "small" if size == "small" else "full"
    out = (f'<rect width="120" height="120" rx="27" fill="url(#{p}tile)"/>'
           f'<rect width="120" height="120" rx="27" fill="url(#{p}tg)"/>'
           f'<rect x=".7" y=".7" width="118.6" height="118.6" rx="26.3" fill="none" stroke="#FFFFFF" stroke-opacity=".14" stroke-width="1.4"/>')
    # the glyph spans x 24..100, y 26..94: shift 2 left so it sits optically centred
    inner = ""
    if size != "small":
        inner += glyph(p, size, f' filter="url(#{p}bl)" opacity=".7"')
    inner += glyph(p, size)
    return out + f'<g transform="translate(60 60) scale({scale or SCALE[size]}) translate(-62 -60)">{inner}</g>'


def svg(px, size, p="", margin=0.0, shadow=False, scale=None):
    total = 120 / (1 - 2 * margin)
    off = (total - 120) / 2
    inner = body(p, size, scale)
    if margin:
        inner = f'<g transform="translate({off:.3f} {off:.3f})"' + (f' filter="url(#{p}shadow)"' if shadow else '') + f'>{inner}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 {total:.3f} {total:.3f}">'
            f'<defs>{defs(p, "small" if size == "small" else "full")}</defs>{inner}</svg>')


# Small sizes are drawn on the pixel grid instead of scaled down, so they stay sharp: per size the
# stroke width, chevron (tip x0 / top y0, vertex x1 at mid height) and cursor (x from ux0 to ux1 at
# uy), in pixels. Horizontal cursor edges and the tile edge fall on whole pixels.
# Windows .ico only.
PIXEL = {
    16: (3, 4.5, 4.5, 8.5, 10.5, 12, 11.5),
    20: (4, 5, 5, 11, 13, 15, 15),
    24: (4, 6, 7, 12, 14, 18, 17),
    32: (5, 8, 8.5, 16.5, 19, 24, 23.5),
}


def pixel_svg(n, p=""):
    w, x0, y0, x1, ux0, ux1, uy = PIXEL[n]
    k, rx, mid = n / 120, round(n * 0.225 * 2) / 2, n / 2
    a, b, c = AURORA
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{n}" height="{n}" viewBox="0 0 {n} {n}"><defs>'
            f'<linearGradient id="{p}tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{TILE_TOP}"/>'
            f'<stop offset="1" stop-color="{TILE_BOTTOM}"/></linearGradient>'
            f'<radialGradient id="{p}tg" cx=".3" cy=".18" r=".9"><stop offset="0" stop-color="{GLOW}" stop-opacity=".35"/>'
            f'<stop offset="1" stop-color="{GLOW}" stop-opacity="0"/></radialGradient>'
            f'<linearGradient id="{p}au" x1="{x0 - w / 2}" y1="{y0 - w / 2}" x2="{ux1 + w / 2}" y2="{uy + w / 2}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{a}"/><stop offset=".5" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></linearGradient></defs>'
            f'<rect width="{n}" height="{n}" rx="{rx}" fill="url(#{p}tile)"/><rect width="{n}" height="{n}" rx="{rx}" fill="url(#{p}tg)"/>'
            f'<rect x=".5" y=".5" width="{n - 1}" height="{n - 1}" rx="{rx - .5}" fill="none" stroke="#FFFFFF" stroke-opacity=".18" stroke-width="1"/>'
            f'<g fill="none" stroke="url(#{p}au)" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="M{x0} {y0} L{x1} {mid} L{x0} {n - y0}"/><path d="M{ux0} {uy} H{ux1}"/></g></svg>')


def variant_for(px):
    return "small" if px <= 32 else "full"
