#!/usr/bin/env python3
"""Draw speedometer tray icons (boost gauge) as PNG + SVG."""
from __future__ import annotations

import math
from pathlib import Path

import cairo

ROOT = Path(__file__).resolve().parent
SIZES = (16, 22, 24, 32, 48, 128, 256)


def draw_gauge(surface: cairo.ImageSurface, on: bool) -> None:
    w = surface.get_width()
    ctx = cairo.Context(surface)
    ctx.set_operator(cairo.OPERATOR_CLEAR)
    ctx.paint()
    ctx.set_operator(cairo.OPERATOR_OVER)

    if on:
        stroke = (0.22, 0.78, 0.72, 1.0)
        fill = (0.18, 0.55, 0.54, 1.0)
        needle = (0.95, 0.97, 0.98, 1.0)
    else:
        stroke = (0.78, 0.81, 0.85, 1.0)
        fill = (0.55, 0.58, 0.62, 1.0)
        needle = (0.90, 0.91, 0.93, 1.0)

    cx = cy = w / 2
    r = w * 0.34
    ctx.set_line_width(max(1.6, w * 0.09))
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_source_rgba(*stroke)
    ctx.arc(cx, cy + w * 0.08, r, math.radians(150), math.radians(30))
    ctx.stroke()

    ctx.set_source_rgba(*fill)
    ctx.arc(cx, cy + w * 0.08, w * 0.07, 0, 2 * math.pi)
    ctx.fill()

    angle = math.radians(-35 if on else 215)
    nx = cx + math.cos(angle) * r * 0.78
    ny = (cy + w * 0.08) + math.sin(angle) * r * 0.78
    ctx.set_source_rgba(*needle)
    ctx.set_line_width(max(1.4, w * 0.08))
    ctx.move_to(cx, cy + w * 0.08)
    ctx.line_to(nx, ny)
    ctx.stroke()


def write_png(path: Path, size: int, on: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    draw_gauge(surface, on)
    surface.write_to_png(str(path))


def main() -> None:
    home_icons = Path.home() / ".local/share/icons/hicolor"
    for on, name in ((True, "cpu-turbo-gauge-on"), (False, "cpu-turbo-gauge-off")):
        for size in SIZES:
            dests = [
                ROOT / "icons" / "hicolor" / f"{size}x{size}" / "apps" / f"{name}.png",
                home_icons / f"{size}x{size}" / "apps" / f"{name}.png",
            ]
            for dest in dests:
                write_png(dest, size, on)
            if not on:
                for dest_root in (ROOT / "icons" / "hicolor", home_icons):
                    write_png(
                        dest_root / f"{size}x{size}" / "apps" / "cpu-turbo-widget.png",
                        size,
                        False,
                    )
    print("wrote gauge icons")


if __name__ == "__main__":
    main()
