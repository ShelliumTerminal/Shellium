"""Packs the rendered PNGs into build/icon.ico (PNG entries, Vista+) and build/icon.icns (PNG entries)."""
import io, os, struct

here = os.path.dirname(os.path.abspath(__file__))
png = lambda name: io.open(os.path.join(here, "png", name + ".png"), "rb").read()


def png_size(data):
    return struct.unpack(">II", data[16:24])


def write_ico(path, names):
    images = [png(n) for n in names]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for data in images:
        w, h = png_size(data)
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs += data
    io.open(path, "wb").write(header + entries + blobs)


def write_icns(path, entries):
    body = b""
    for kind, name in entries:
        data = png(name)
        body += kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    io.open(path, "wb").write(b"icns" + struct.pack(">I", len(body) + 8) + body)


out = os.path.join(here, "out")
os.makedirs(out, exist_ok=True)
write_ico(os.path.join(out, "icon.ico"), ["win-16", "win-20", "win-24", "win-32", "win-40", "win-48", "win-64", "win-128", "win-256"])
write_icns(os.path.join(out, "icon.icns"), [
    ("icp4", "mac-16"), ("icp5", "mac-32"), ("icp6", "mac-64"), ("ic07", "mac-128"), ("ic08", "mac-256"),
    ("ic09", "mac-512"), ("ic10", "mac-1024"), ("ic11", "mac-32"), ("ic12", "mac-64"), ("ic13", "mac-512"), ("ic14", "mac-1024"),
])
io.open(os.path.join(out, "icon.png"), "wb").write(png("linux-1024"))
for name in ("icon.ico", "icon.icns", "icon.png"):
    print(name, os.path.getsize(os.path.join(out, name)), "bytes")
