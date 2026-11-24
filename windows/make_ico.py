#!/usr/bin/env python3
"""Generate a clean multi-size Windows .ico (PNG-embedded 32/64/128/256px) for MindFlow."""
import math
import struct
import sys
import zlib


def render_png(size: int) -> bytes:
    W = H = size
    raw = bytearray()
    scale = size / 1024.0

    def seg_dist(px, py, x1, y1, x2, y2):
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        if l2 == 0:
            return math.hypot(px - x1, py - y1)
        t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / l2))
        return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

    nodes = [
        (512 * scale, 512 * scale, 118 * scale),
        (256 * scale, 300 * scale, 72 * scale),
        (768 * scale, 300 * scale, 72 * scale),
        (256 * scale, 724 * scale, 72 * scale),
        (768 * scale, 724 * scale, 72 * scale),
    ]
    links = [
        (512 * scale, 512 * scale, 256 * scale, 300 * scale),
        (512 * scale, 512 * scale, 768 * scale, 300 * scale),
        (512 * scale, 512 * scale, 256 * scale, 724 * scale),
        (512 * scale, 512 * scale, 768 * scale, 724 * scale),
    ]

    margin = 84 * scale
    radius = 210 * scale
    half = W / 2.0
    inner = half - margin - radius
    lw = 24.0 * scale

    for y in range(H):
        raw.append(0)
        for x in range(W):
            ax = abs(x - half) - inner
            ay = abs(y - half) - inner
            sdf = math.hypot(max(ax, 0.0), max(ay, 0.0)) - radius
            if sdf > 1.5:
                raw.extend((0, 0, 0, 0))
                continue
            alpha = max(0.0, min(1.0, 0.5 - sdf / 2.0))
            t = (x * 0.55 + y * 0.45) / W
            if t < 0.5:
                u = t * 2.0
                r = int(79 + (139 - 79) * u)
                g = int(70 + (92 - 70) * u)
                b = int(229 + (246 - 229) * u)
            else:
                u = (t - 0.5) * 2.0
                r = int(139 + (236 - 139) * u)
                g = int(92 + (72 - 92) * u)
                b = int(246 + (153 - 246) * u)

            fg = 0.0
            for x1, y1, x2, y2 in links:
                d = seg_dist(x, y, x1, y1, x2, y2) - lw
                if d < 2.0:
                    fg = max(fg, max(0.0, min(1.0, 0.5 - d / 2.0)) * 0.92)
            for nx, ny, nr in nodes:
                d = math.hypot(x - nx, y - ny) - nr
                if d < 2.0:
                    fg = max(fg, max(0.0, min(1.0, 0.5 - d / 2.0)))

            r = int(r * (1.0 - fg) + 255 * fg)
            g = int(g * (1.0 - fg) + 255 * fg)
            b = int(b * (1.0 - fg) + 255 * fg)
            raw.extend((r, g, b, int(alpha * 255)))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 6)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "MindFlow.ico"
    sizes = [32, 64, 128, 256]
    images = [(sz, render_png(sz)) for sz in sizes]

    header = struct.pack("<HHH", 0, 1, len(images))
    entries = bytearray()
    offset = 6 + 16 * len(images)
    blobs = bytearray()

    for sz, data in images:
        dim = 0 if sz == 256 else sz
        entries.extend(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset))
        blobs.extend(data)
        offset += len(data)

    with open(out_path, "wb") as f:
        f.write(header + entries + blobs)


if __name__ == "__main__":
    main()
